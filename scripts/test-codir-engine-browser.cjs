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
    const cliCalls=[];
    const pick=async(sel,label)=>{const els=await open(sel);const el=els.find(e=>lab(e)===label);check(el,'option '+label+': '+els.map(lab).join(','));el.click();await tick()};
    let guides=[];
    async function mount(saved,cli={}){
      const sets=[];cliCalls.length=0;
      const api={getSettings:async()=>saved,setSettings:async p=>{sets.push(p);return {}},codirGuides:async()=>guides,codirModels:async()=>[{id:'claude-sonnet-5-5',label:'Sonnet 5.5 — recommended balance ($2 / $10 per MTok)'},{id:'claude-haiku-4-5',label:'Haiku 4.5 — fastest & cheapest ($1 / $5)'}],
        codirBridgeModels:async()=>[{id:'claude-fable-5',label:'Fable 5 — the strongest'}],codirBridgeStatus:async()=>({found:true,detail:'Claude Code 2.1.300',version:'2.1.300'}),
        codirVeniceModels:async()=>[{id:'claude-sonnet-5-5',label:'Sonnet 5.5 — recommended balance ($3.75 / $18.75 per MTok on Venice)'},{id:'claude-opus-5-5',label:'Opus 5.5 — strongest writing ($4.80 / $24)'}],
        // list 35: the other command-line tools and DeepSeek
        codirCliStatus:async(k,refresh)=>{cliCalls.push(['status',k,!!refresh]);return cli[k]??{found:false,detail:''}},
        codirCliLogin:async k=>{cliCalls.push(['login',k]);return {found:true,detail:'codex-cli 0.159.2 — the Codex app’s own copy — Logged in using ChatGPT',loggedIn:true,ok:true,out:''}},
        codirCliModels:async k=>k==='codex'?[{id:'gpt-6.1-sol',label:'GPT-6.1-Sol — the newest (default)'},{id:'gpt-5.5',label:'GPT-5.5'}]:[{id:'auto',label:'Auto — Gemini CLI picks (default)'},{id:'pro',label:'Pro — for complex reasoning'}],
        codirDeepseekModels:async()=>[{id:'deepseek-v4-pro',label:'DeepSeek V4 Pro — the strongest, sees no pictures ($0.66–1.32 / $1.98–3.96 per MTok)'},{id:'deepseek-flash',label:'DeepSeek Flash — fast, sees pictures ($0.15–0.30 / $0.60–1.20)'}]};
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
      check(JSON.stringify(opts)==='[{"label":"Anthropic API","dim":false},{"label":"Claude Code bridge","dim":false},{"label":"Venice API","dim":false},{"label":"ChatGPT (Codex)","dim":true},{"label":"Gemini CLI","dim":true},{"label":"DeepSeek API","dim":false}]','six engines; a tool that is not on this machine is greyed: '+JSON.stringify(opts));
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
      check(JSON.stringify(levels)===JSON.stringify(['thinking: auto','thinking: low','thinking: medium','thinking: high','thinking: xhigh','thinking: max']),'the levels: '+levels.join(' | '));
      // his note 10-02 ("should be a drop down next to the model name not uder it"): one line, the model pick gives way
      const sameLine=()=>{const t=document.querySelector(THINK),row=t.parentElement,m=t.previousElementSibling,R=row.getBoundingClientRect(),a=m.getBoundingClientRect(),b=t.getBoundingClientRect();return Math.abs(a.top-b.top)<2&&b.left>a.right&&b.right<=R.right+1};
      check(sameLine(),'the thinking pick sits right beside the model pick, on its line (the long API names)');
      await pick(THINK,'thinking: max');
      check(JSON.stringify(s.sets.at(-1))==='{"codirEffort":"max"}','the level is saved: '+JSON.stringify(s.sets.at(-1)));
      check(cur(document.querySelector(THINK))==='thinking: max','… and shown: '+cur(document.querySelector(THINK)));
      s.root.unmount();
      // a saved level comes back; Haiku has no levels, so the pick greys and says why
      s=await mount({codirEngine:'api',anthropicKey:'••••9999',codirModel:'claude-sonnet-5-5',codirEffort:'xhigh'});
      check(cur(document.querySelector(THINK))==='thinking: xhigh','the saved level loads: '+cur(document.querySelector(THINK)));
      s.root.unmount();
      s=await mount({codirEngine:'api',anthropicKey:'••••9999',codirModel:'claude-haiku-4-5',codirEffort:'xhigh'});
      const grey=document.querySelector('[title="Haiku 4.5 has no thinking levels"]');
      check(grey&&cur(grey)==='thinking: auto'&&grey.style.opacity==='0.5','Haiku: the level greys, with the reason: '+(grey&&cur(grey)));
      check((await open('[title="Haiku 4.5 has no thinking levels"]')).length===0,'… and does not open');
      s.root.unmount();

      // ---- list 35: ChatGPT through Codex, Google through Gemini CLI, DeepSeek on a key ----
      const CODEX={found:true,detail:'codex-cli 0.159.2 — the Codex app’s own copy — Logged in using ChatGPT',loggedIn:true},OUT={found:true,detail:'codex-cli 0.159.2 — the Codex app’s own copy — NOT SIGNED IN',loggedIn:false};
      s=await mount({codirEngine:'api',anthropicKey:'••••9999'},{codex:CODEX});
      const line=k=>document.querySelector('[data-cli="'+k+'"]');
      check(line('codex').textContent.trim()==='✓ Codex: codex-cli 0.159.2 — the Codex app’s own copy — Logged in using ChatGPT','Codex’s own line: '+line('codex').textContent);
      check(line('gemini').textContent.includes('Gemini CLI not found — install with npm install -g @google/gemini-cli')&&[...line('gemini').querySelectorAll('.btn')].some(b=>b.textContent.trim()==='re-check'),'Gemini CLI says how it gets here: '+line('gemini').textContent);
      check(document.body.textContent.includes('✓ Claude Code: Claude Code 2.1.300'),'the Claude line names its tool too');
      const opts2=(await open(ENGINE)).map(e=>({label:lab(e),dim:e.style.color==='var(--dim)'}));await close();
      check(!opts2[3].dim&&opts2[4].dim,'Codex is here, Gemini CLI is not: '+JSON.stringify(opts2));
      await pick(ENGINE,'ChatGPT (Codex)');
      check(JSON.stringify(s.sets.at(-1))==='{"codirEngine":"codex"}','the pick is saved: '+JSON.stringify(s.sets.at(-1)));
      check(s.fold.textContent.includes('⚭ chatgpt'),'the badge: '+s.fold.textContent);
      check(document.body.textContent.includes('your local Codex, on your ChatGPT login'),'whose login it runs on');
      const CM='[title="your local Codex, on your ChatGPT login"]';
      const cms=(await open(CM)).map(lab);await close();
      check(JSON.stringify(cms)==='["GPT-6.1-Sol — the newest (default)","GPT-5.5"]','Codex’s own models: '+cms.join(' | '));
      await pick(CM,'GPT-5.5');
      check(JSON.stringify(s.sets.at(-1))==='{"codirCodexModel":"gpt-5.5"}','its model is saved apart: '+JSON.stringify(s.sets.at(-1)));
      check(document.querySelector(THINK)&&(await open(THINK)).length===6,'Codex takes the thinking levels');await close();
      s.root.unmount();
      // signed out of ChatGPT: the line offers Codex's own sign-in
      s=await mount({codirEngine:'codex',codirCodexModel:'gpt-5.5'},{codex:OUT,gemini:{found:true,detail:'0.62.0 — npm install — signed in with Google',loggedIn:true}});
      check(line('codex').textContent.startsWith('✕ Codex:'),'signed out: '+line('codex').textContent);
      [...line('codex').querySelectorAll('.btn')].find(b=>b.textContent.trim()==='sign in to chatgpt').click();await tick(200);
      check(JSON.stringify(cliCalls.at(-1))==='["login","codex"]'&&line('codex').textContent.startsWith('✓ Codex:'),'the button runs Codex’s own sign-in: '+JSON.stringify(cliCalls.at(-1))+' '+line('codex').textContent);
      // Gemini CLI: its own model names, and no thinking levels
      await pick(ENGINE,'Gemini CLI');
      check(JSON.stringify(s.sets.at(-1))==='{"codirEngine":"gemini"}'&&s.fold.textContent.includes('⚭ gemini'),'Gemini CLI picked: '+s.fold.textContent);
      const gms=(await open('[title="your local Gemini CLI, on your Google login"]')).map(lab);await close();
      check(gms[0]==='Auto — Gemini CLI picks (default)'&&gms.length===2,'its own models: '+gms.join(' | '));
      const greyG=document.querySelector('[title="Gemini CLI has no thinking levels"]');
      check(greyG&&greyG.style.opacity==='0.5','Gemini CLI: the level greys, with the reason');
      // DeepSeek: a key engine
      await pick(ENGINE,'DeepSeek API');
      check(s.fold.textContent.includes('○ needs the DeepSeek key')&&document.body.textContent.includes('⚠ needs the DeepSeek key — paste it above'),'no key: said twice: '+s.fold.textContent);
      const dms=(await open('[title="your DeepSeek key, billed per token"]')).map(lab);await close();
      check(dms.length===2&&dms[0].startsWith('DeepSeek V4 Pro')&&dms[1].startsWith('DeepSeek Flash'),'DeepSeek’s two models: '+dms.join(' | '));
      s.root.unmount();
      s=await mount({codirEngine:'deepseek',deepseekKey:'••••7777'});
      check(s.fold.textContent.includes('● deepseek')&&document.body.textContent.includes('uses the DeepSeek key above — no web research on this engine'),'with its key: '+s.fold.textContent);
      check([...document.querySelectorAll('input[type=password]')].some(i=>i.placeholder==='paste DeepSeek key'),'its key has a box in this card');
      check(sameLine(),'DeepSeek’s longest model names: the thinking pick still sits beside the model pick');
      s.root.unmount();
      // his note 10-02: the guide files' buttons at the row's right edge, edit last in every row (lined up)
      guides=[{id:'codirector',label:'Co-Director instructions',loaded:true,customised:true,hasLearned:true},{id:'canon',label:'Master knowledge — prompting canon',loaded:true,customised:false},{id:'rigs',label:'Director rigs',loaded:false,customised:false}];
      s=await mount({codirEngine:'api',anthropicKey:'••••9999'});await tick(200);
      const rows=guides.map(g=>[...document.querySelectorAll('span')].find(x=>x.textContent===g.label).parentElement);
      const btns=rows.map(r=>[...r.querySelectorAll('.btn')]);
      check(btns.every(b=>b.length&&b[b.length-1].textContent.trim()==='edit')&&btns[0].map(b=>b.textContent.trim()).join()==='revert,purge learned,edit','edit is last in every row: '+JSON.stringify(btns.map(b=>b.map(x=>x.textContent.trim()))));
      const rights=btns.map(b=>Math.round(b[b.length-1].getBoundingClientRect().right)),rowRight=Math.round(rows[0].getBoundingClientRect().right);
      check(rights.every(x=>x===rights[0])&&Math.abs(rights[0]-rowRight)<=1,'the edit buttons line up at the right edge: '+rights.join()+' / '+rowRight);
      s.root.unmount();
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'Settings: the Co-Director engine is a six-way pick from one table; Venice = its own models, a venice badge, the key named; the choice is saved; the thinking level sits beside the model (auto + five, greyed on Haiku and on Gemini CLI); ChatGPT (Codex) and Gemini CLI each say whether their tool is here and signed in, offer its own sign-in, list their own models and grey when the tool is missing; DeepSeek has its key box, its two models and says when the key is missing';
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
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8')) // the house buttons
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
