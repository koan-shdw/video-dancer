// list 37 (2026-09-30) — the missing-key steps. A job that needs an API key he hasn't saved opens
// that supplier's key steps instead of failing in a toast: get a key on their page, paste it, save
// (checked first with the supplier's own free call, where there is one). Every no-key message the
// app's core produces is read off its source and must open the right supplier. The real toast and
// the real modal, offscreen Electron, the app's API mocked: no key is sent anywhere.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-key-wizard-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  // every "No … key" line in main, as written there
  const mainDir = path.resolve(__dirname, '../src/main')
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []))
  const found = new Set()
  for (const f of walk(mainDir)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/['`](No [^'`\n]{0,40}?key[^'`\n]{0,160})['`]/g)) found.add(m[1])
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Toasts, toast} from '${ui}/ui/Toast';
    import {KeyWizard} from '${ui}/ui/KeyWizard';
    import {missingKeyOf, KEY_SUPPLIERS} from '${ui}/lib/keySuppliers';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const MAIN=${JSON.stringify([...found])};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      // ---- whose key: every no-key line main can say ----
      const who=t=>missingKeyOf(t)?.id??null;
      check(MAIN.length>=12,'main’s no-key lines were found: '+MAIN.length);
      const want={'fal admin key':null,'fal key':'fal','ModelArk':'ark','Astria':'astria','Venice':'venice','Higgsfield':'higgsfield','ElevenLabs':'eleven','Google':'google','Anthropic':'anthropic','API key saved for the Co-Director':'anthropic','DeepSeek':'deepseek','Civitai':'civitai','OpenAI':'openai'};
      for(const line of MAIN){const k=Object.keys(want).find(k=>line.includes(k));check(k!==undefined,'a no-key line nobody owns: '+line);check(who(line)===want[k],line+' → '+who(line)+', wanted '+want[k])}
      check(who('Rooftop: failed — No ElevenLabs key saved — paste it in Settings first.')==='eleven','behind a job’s name');
      check(who('No key frames on this clip')===null&&who('error (404) @ modelark/submit: ModelNotOpen')===null&&who('the key works')===null,'other errors are not a missing key');
      check(new Set(KEY_SUPPLIERS.map(s=>s.setting)).size===KEY_SUPPLIERS.length&&KEY_SUPPLIERS.every(s=>s.url.startsWith('https://')),'one row per key, each with its page');

      // ---- the steps ----
      const opened=[],saved=[],tested=[];let verdict={ok:false,error:'Invalid API key'};
      setVidancerApi(new Proxy({openExternal:async u=>{opened.push(u)},setSettings:async p=>{saved.push(p);return p},elevenValidate:async k=>{tested.push(k);return verdict},llmValidateKey:async(provider,k)=>{tested.push([provider,k]);return {ok:true}}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      createRoot(document.getElementById('root')).render(<><Toasts/><KeyWizard/></>);await tick(200);
      const dialog=()=>document.querySelector('[role=dialog]');
      toast('Rooftop: render done ✓',{kind:'ok'});toast('export failed: disk full',{kind:'error'});await tick();
      check(!dialog()&&document.body.textContent.includes('export failed: disk full'),'an ordinary error is still a toast');
      toast('No ElevenLabs key saved — paste it in Settings first.',{kind:'info'});await tick();
      check(!dialog(),'only an error opens the steps');
      const WHY='Rooftop score: failed — No ElevenLabs key saved — paste it in Settings → API → ElevenLabs.';
      toast(WHY,{kind:'error'});await tick(200);
      check(dialog()&&dialog().textContent.startsWith('ElevenLabs key needed'),'the steps open, named for the supplier: '+dialog()?.textContent.slice(0,60));
      check(dialog().textContent.includes(WHY),'it says what needed the key');
      check([...document.querySelectorAll('div')].filter(d=>d.textContent===WHY&&d.style.cursor==='pointer').length===0,'and no toast repeats it');
      const btn=l=>[...dialog().querySelectorAll('.btn')].find(b=>b.textContent.trim()===l);
      btn('get a key ↗').click();await tick();
      check(opened.at(-1)==='https://elevenlabs.io/app/settings/api-keys','step 1 opens their key page: '+opened.at(-1));
      const input=dialog().querySelector('input[type=password]');
      const type=v=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,v);input.dispatchEvent(new Event('input',{bubbles:true}))};
      btn('save key').click();await tick();check(tested.length===0&&saved.length===0,'nothing to save yet');
      type('  sk_wrong  ');await tick();btn('save key').click();await tick(200);
      check(tested.at(-1)==='sk_wrong'&&saved.length===0,'a refused key is checked and never saved');
      check(dialog().querySelector('[role=status]').textContent==='that key was refused: Invalid API key','the supplier’s own words: '+dialog().querySelector('[role=status]').textContent);
      verdict={ok:true};type('sk_right');await tick();btn('save key').click();await tick(200);
      check(JSON.stringify(saved)==='[{"elevenKey":"sk_right"}]','the key lands in Settings: '+JSON.stringify(saved));
      check(dialog().querySelector('[role=status]').textContent==='key works and is saved. run it again.'&&input.value==='','it says so, and the field is cleared');
      btn('done').click();await tick();check(!dialog(),'done closes it');
      // Anthropic now uses the shared free LLM key check before saving.
      toast('Co-Director: No Anthropic key saved — paste one in Settings (or switch the Co-Director to bridge).',{kind:'error'});await tick(200);
      check(dialog().textContent.startsWith('Anthropic key needed'),'the Co-Director’s missing key opens Anthropic’s steps');
      const i2=dialog().querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i2,'sk-ant-x');i2.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      btn('save key').click();await tick(200);
      check(JSON.stringify(saved.at(-1))==='{"anthropicKey":"sk-ant-x"}'&&JSON.stringify(tested.at(-1))==='["anthropic","sk-ant-x"]'&&dialog().querySelector('[role=status]').textContent.includes('saved'),'Anthropic key checked before saving');
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'missing-key steps: every no-key line in main ('+MAIN.length+') opens the right supplier; get a key, paste, save; a refused key is never saved; ordinary errors stay toasts';
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
    const win = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
