// CODIR-BATCH-SPEC-2026-10-03 — the window's half, driven with REAL input (webContents.sendInputEvent)
// and the house CSS. The app's API is a mock: renders are held and released by the test, nothing is
// spent. (A) Image Gen's line keeps each render's prompt from the moment it was queued: his clicks
// (type, ＋ Queue, type, ＋ Queue while a render runs) and the Co-Director's 10-03 run replayed
// (write the gen's prompt, fire, eight times). (C) a prompts list = one run each, the gen untouched.
// (F) Watched and lora-example tiles select like the take trays and ~ tags them for the Co-Director.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-batch-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ImageGenPanel} from '${ui}/panels/ImageGen';
    import {WatchPanel, CivitExamplesPanel} from '${ui}/panels/Watch';
    import {listenForFire} from '${ui}/lib/codirFire';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms));
    const W=window;W.__errors=[];
    export async function setup(){
      window.addEventListener('error',e=>W.__errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>W.__errors.push(String(e.reason)));
      W.__ran=[];W.__recipes=[];W.__holds=[];W.__replies=[];W.__saves=[];W.__sent=[];
      const api={projectRecents:async()=>[],getSettings:async()=>({}),setSettings:async()=>true,
        imageGenStatus:async()=>({engine:true,essentials:true,pack:true,official:['krea-2-quality'],civit:[]}),imageGenLoras:async()=>[],imageGenFolders:async()=>[],imageGenThumb:async()=>null,moodList:async()=>[],
        // main, stood in: a render reads the recipe it was handed, else the gen as saved when it STARTS
        // (index.ts imagegen:render: req.recipe ?? g.recipe), and runs until the test releases it
        imageGenRender:a=>new Promise(res=>{const g=useStore.getState().project.imageGens.find(x=>x.id===a.imageGenId);W.__ran.push((a.recipe??g.recipe).prompt);W.__recipes.push(a.recipe??g.recipe);W.__holds.push(()=>res({ok:true,takeIds:[]}))}),
        // main's save: the gen changes and the delta comes back, as imagegen:set does
        imageGenSet:async(id,patch)=>{W.__saves.push([id,patch]);const p=useStore.getState().project;return{imageGens:p.imageGens.map(g=>g.id===id?{...g,...(patch.name?{name:patch.name}:{}),recipe:{...g.recipe,...(patch.recipe||{})}}:g)}},
        onCodirFire:cb=>{W.__ask=cb;return()=>{}},codirFireDone:async(reqId,r)=>{W.__replies.push([reqId,r])},
        watchList:async()=>['a','b','c'].map(n=>({file:'C:/forge/'+n+'.png',name:n+'.png',mtime:1})),
        civitVersionImages:async()=>({ok:true,items:[11,12,13].map(id=>({id,thumbUrl:'https://image.civitai.com/x/'+id+'/width=450/'+id+'.jpeg',fullUrl:'https://image.civitai.com/x/'+id+'/original=true/'+id+'.jpeg',width:800,height:1000,username:'poster',hasPrompt:false}))}),
        civitImageFile:async(id)=>({ok:true,file:'C:/cache/'+id+'.jpeg'}),spendList:async()=>({total:0,entries:[]}),civitGeneration:async()=>({ok:true,settings:{source:'civit',prompt:'a samurai',loras:[]}}),
        codirSend:async req=>{W.__sent.push(req);return{ok:true,reply:'ok'}}};
      W.__unknown=new Set();setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:(W.__unknown.add(String(k)),async()=>null)}));
      const gen={id:'g1',name:'Fractal Fantasy',takes:[],recipe:{prompt:'P0',model:'krea-2-quality',aspect:'3:4',megapixels:2,batch:1,seed:0,refOn:false,refBoost:2.1,refBoostB:1,loraOn:false,loras:[],unleashedOn:false,unleashedWeight:1}};
      useStore.setState({project:{dir:'synthetic',name:'Test',watchFolder:'C:/forge',clips:[],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[gen],timelines:[{id:'tl',name:'T',aspectRatio:'16:9',items:[]}],activeTimelineId:'tl',folders:[],codir:{log:[],brief:''}},editorImageGenId:'g1',codirTags:[]});
      W.__off=listenForFire();
      createRoot(document.getElementById('root')).render(<div style={{display:'flex',width:1580,height:1400}}><div style={{width:760}}><ImageGenPanel/></div><div style={{width:400}}><WatchPanel/></div><div style={{width:400}}><CivitExamplesPanel versionId={777} name="Samurai Style"/></div></div>);
      await tick(700);
    }
    const box=el=>{if(!el)return null;el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height}};
    export const queueBtn=()=>box([...document.querySelectorAll('.btn')].find(b=>/^＋ Queue/.test(b.textContent.trim())));
    export const promptBox=()=>box(document.querySelector('textarea[placeholder="describe the image…"]'));
    export const promptValue=()=>document.querySelector('textarea[placeholder="describe the image…"]').value;
    export const watchTile=i=>box(document.querySelectorAll('[data-nav^="C:/forge/"]')[i]);
    export const civitTile=i=>box(document.querySelectorAll('[data-nav="'+[11,12,13][i]+'"]')[i===undefined?0:0]);
    export const ran=()=>JSON.stringify(W.__ran);
    export const holds=()=>W.__holds.length;
    export const releaseOne=async()=>{const h=W.__holds.shift();if(h)h();await tick(120);return W.__ran.length};
    // the Co-Director's write: set_image_gen_prompt lands in the window as a project delta
    export const coWrite=async p=>{const s=useStore.getState();s.applyDelta({imageGens:s.project.imageGens.map(g=>g.id==='g1'?{...g,recipe:{...g.recipe,prompt:p}}:g)});useStore.setState(st=>({undoTick:(st.undoTick||0)+1}));await tick(150)};
    export const coFire=async(reqId,prompts)=>{W.__ask({reqId,kind:'image_gen',id:'g1',...(prompts?{prompts}:{})});for(let i=0;i<80&&!W.__replies.some(r=>r[0]===reqId);i++)await tick(50);const r=W.__replies.find(x=>x[0]===reqId);return JSON.stringify(r?r[1]:null)};
    // the Co-Director's set_image_gen_settings right after a fire: lora ×1 and unleashed on
    export const coSettings=async()=>{const s=useStore.getState();s.applyDelta({imageGens:s.project.imageGens.map(g=>g.id==='g1'?{...g,recipe:{...g.recipe,loraOn:true,loras:[{name:'KREA 2/houseofuday.safetensors',weight:1}],unleashedOn:true,unleashedWeight:1}}:g)});await tick(100)};
    export const lastSent=n=>JSON.stringify(W.__recipes.slice(-n).map(r=>[r.prompt,r.loraOn,r.loras.map(l=>l.weight),r.unleashedOn]));
    export const genPrompt=()=>useStore.getState().project.imageGens[0].recipe.prompt;
    export const tags=()=>JSON.stringify(useStore.getState().codirTags.map(t=>t.key));
    export const tagObjs=()=>JSON.stringify(useStore.getState().codirTags);
    export const stars=()=>[...document.querySelectorAll('[aria-label^="tagged for the Co-Director"]')].length;
    export const rings=()=>[...document.querySelectorAll('[data-nav]')].filter(el=>getComputedStyle(el).outlineStyle==='solid').map(el=>el.getAttribute('data-nav')).join(',');
    export const menuOpen=()=>!!document.querySelector('.koan-ctx, [role=menu]')||[...document.querySelectorAll('div')].some(d=>/send to prompt|send both|import to Library/.test(d.textContent)&&d.children.length<30&&getComputedStyle(d).position==='fixed');
    export const send=async()=>{await useStore.getState().codirSendText('make some from the tagged ones');await tick(150);return JSON.stringify(W.__sent.at(-1).tags.map(t=>t.key))};
    export const errors=()=>W.__errors.join(' | ')+(W.__errors.length?' (unmocked: '+[...W.__unknown].join(',')+')':'');
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 120000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l)).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1600, height: 1400, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    const js = (s) => win.webContents.executeJavaScript(s)
    await js(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.setup()')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const check = (v, m) => { if (!v) throw Error(m) }
    const c = (s) => js('checks.' + s)
    const ev = async (type, x, y, o = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: o.button || 'left', clickCount: 1, modifiers: o.mods || [] }); await wait(40) }
    const click = async (b, o = {}) => { const x = b.l + b.w / 2, y = b.t + Math.min(b.h / 2, 12); await ev('mouseMove', x, y, o); await ev('mouseDown', x, y, o); await ev('mouseUp', x, y, o); await wait(120) }
    const key = async (keyCode, mods = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods }); await wait(30); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods }); await wait(150) }
    const type = async (text) => { for (const ch of text) { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(15) } await wait(100) }
    const retype = async (text) => { await click(await c('promptBox()')); await key('A', ['control']); await key('Backspace'); await type(text) }
    const drain = async () => { for (let i = 0; i < 30 && (await c('holds()')); i++) await c('releaseOne()') }

    // ---- A, his clicks: a render runs, and while it does he types and queues three more ----
    await click(await c('queueBtn()'))
    check((await c('holds()')) === 1, 'the first ＋ Queue starts a render: ' + (await c('ran()')))
    for (const p of ['P1 samurai on a koi', 'P2 crowned cyclops', 'P3 goddess of milk']) {
      await retype(p)
      check((await c('promptValue()')) === p, 'the box holds what was typed: ' + (await c('promptValue()')))
      await click(await c('queueBtn()'))
    }
    await drain()
    check((await c('ran()')) === JSON.stringify(['P0', 'P1 samurai on a koi', 'P2 crowned cyclops', 'P3 goddess of milk']), 'each queued render ran the prompt it was queued with: ' + (await c('ran()')))

    // ---- A, the Co-Director's 10-03 run replayed: write the gen's prompt, fire, eight times, a render already going ----
    await c('releaseOne()')
    const before = JSON.parse(await c('ran()')).length
    await retype('P4 holding the GPU'); await click(await c('queueBtn()'))
    const eight = ['Obsidian', 'Reef', 'Orchid', 'Insect queen', 'Clockwork saint', 'Frost', 'Blood moon', 'Two eyes']
    for (const [i, p] of eight.entries()) {
      await c(`coWrite(${JSON.stringify(p)})`)
      const r = JSON.parse(await c(`coFire('f${i}')`))
      check(r && r.ok, 'the fire was answered: ' + JSON.stringify(r))
    }
    await drain()
    const run8 = JSON.parse(await c('ran()')).slice(before)
    check(JSON.stringify(run8) === JSON.stringify(['P4 holding the GPU', ...eight]), 'all eight rendered their own prompt, in order (10-03 gave 1 Insect queen + 7 Two eyes): ' + JSON.stringify(run8))

    // ---- C: one fire with a prompts list = one run each; the gen keeps its prompt, nothing saved over it ----
    const genBefore = await c('genPrompt()'), saves = await js('window.__saves.length')
    const rl = JSON.parse(await c(`coFire('list', ['L1 obsidian helmet', 'L2 reef crown', 'L3 frost eye'])`))
    check(rl.ok && /3 runs × 1 image/.test(rl.line), 'a list is answered with its runs: ' + JSON.stringify(rl))
    await c('coSettings()') // his 10-03 case: change the loras and unleashed right after firing
    await drain()
    check((await c('lastSent(3)')) === JSON.stringify([['L1 obsidian helmet', false, [], false], ['L2 reef crown', false, [], false], ['L3 frost eye', false, [], false]]), 'the queued runs keep the settings they were fired with: ' + (await c('lastSent(3)')))
    check(JSON.stringify(JSON.parse(await c('ran()')).slice(-3)) === JSON.stringify(['L1 obsidian helmet', 'L2 reef crown', 'L3 frost eye']), 'the list ran in order: ' + (await c('ran()')))
    check((await c('genPrompt()')) === genBefore && (await js('window.__saves.length')) === saves, 'the gen’s own prompt stays, nothing was written over it')

    // ---- F, Watched: click selects (the ring), ~ tags, Ctrl-click adds, ~ toggles the selected ----
    await click(await c('watchTile(0)'))
    check((await c('rings()')) === 'C:/forge/a.png', 'a click selects that tile: ' + (await c('rings()')))
    await key('`')
    check((await c('tags()')) === JSON.stringify(['C:/forge/a.png']) && (await c('stars()')) === 1, '~ tags it and it wears a ★: ' + (await c('tags()')))
    await click(await c('watchTile(1)'), { mods: ['control'] })
    check((await c('rings()')) === 'C:/forge/a.png,C:/forge/b.png', 'Ctrl-click adds to the selection: ' + (await c('rings()')))
    await key('`', ['shift']) // the ~ itself
    check((await c('tags()')) === JSON.stringify(['C:/forge/a.png', 'C:/forge/b.png']) && (await c('stars()')) === 2, 'with one of them untagged, ~ tags them both: ' + (await c('tags()')))
    await key('`')
    check((await c('tags()')) === '[]' && (await c('stars()')) === 0, 'all tagged, ~ untags them: ' + (await c('tags()')))
    await key('Right')
    check((await c('rings()')) === 'C:/forge/c.png', 'the arrows move the selection (from b to c): ' + (await c('rings()')))
    await key('`')
    check((await c('tags()')) === JSON.stringify(['C:/forge/c.png']), '~ tags where the arrows sit: ' + (await c('tags()')))

    // ---- F, a lora's examples: the same select, Shift-click = range; right-click still opens the settings menu ----
    await click(await js(`(()=>{const el=document.querySelector('[data-nav="11"]');const r=el.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height}})()`))
    check(!(await c('menuOpen()')), 'a plain click selects, it no longer opens the menu')
    await click(await js(`(()=>{const el=document.querySelector('[data-nav="13"]');const r=el.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height}})()`), { mods: ['shift'] })
    check((await c('rings()')).endsWith('11,12,13'), 'Shift-click selects the range: ' + (await c('rings()')))
    await key('`')
    const t = JSON.parse(await c('tagObjs()'))
    check(JSON.stringify(t.map((x) => x.key)) === JSON.stringify(['C:/forge/c.png', 'civit:11', 'civit:12', 'civit:13']) && t[1].civit.id === 11 && /width=450/.test(t[1].civit.thumbUrl), 'the three examples are tagged with what main needs: ' + JSON.stringify(t[1]))
    check((await c('stars()')) === 4, 'every tagged tile wears a ★')
    await click(await js(`(()=>{const el=document.querySelector('[data-nav="12"]');const r=el.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height}})()`), { button: 'right' })
    await wait(250)
    check(await c('menuOpen()'), 'right-click opens the prompt + loras menu')

    // ---- the tags ride the next message ----
    check((await c('send()')) === JSON.stringify(['C:/forge/c.png', 'civit:11', 'civit:12', 'civit:13']), 'the Co-Director gets every tag with the message')
    const errs = await c('errors()'); check(!errs, 'no errors: ' + errs)
    console.log('PASS real input: Image Gen’s line keeps each render’s prompt from the moment it was queued (his type + ＋ Queue while rendering, and the Co-Director’s 10-03 run of eight replayed: all eight rendered their own); a prompts list runs one each, keeps the settings it was fired with when the loras change right after, and leaves the gen’s prompt alone; Watched and lora-example tiles select like the take trays (click, Ctrl, Shift, arrows), ~ tags and untags the selected with a ★, right-click still opens the menu, and the tags ride the next message')
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.stack)); app.exit(1) } })
}
