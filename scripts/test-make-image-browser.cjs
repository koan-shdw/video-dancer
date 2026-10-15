// 10-15 (his ask): Library right-click → "make image" opens a NEW Image Gen card filled from the
// image's prompt data — the Image Gen take it was saved from (whole recipe), else the PNG's own
// settings (loras matched to his folders, size → aspect + MP), else the Image Editor prompt. The
// seed is always random. With no prompt data the card opens on its defaults and the Co-Director
// says so and asks to help; "yes" (button or typed) sends the whole ask with the image, and the
// stubbed reply's prompt lands in that card. Real input (sendInputEvent) + the house CSS.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-make-image-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/') // a module calls the API as it loads
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {LibraryPanel} from '${ui}/panels/Library'; import {ImageGenPanel} from '${ui}/panels/ImageGen'; import {CoDirectorPanel} from '${ui}/panels/CoDirector';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api'; import {setMediaBase} from '${ui}/media';
    import {codirEngineRow} from '${ui}/shared/models'; import {Toasts} from '${ui}/ui/Toast';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms));
    let errors=[], n=0;
    export const sent=[];
    const pic=(w,h,c)=>{const k=document.createElement('canvas');k.width=w;k.height=h;const x=k.getContext('2d');x.fillStyle=c;x.fillRect(0,0,w,h);return k.toDataURL()};
    const SNAP={model:'krea-2-quality',prompt:'a red fox in snow',aspect:'2:3',megapixels:1.5,batch:2,seed:777,refOn:false,refBoost:2.1,refBoostB:1,loraOn:true,loras:[{name:'KREA 2/cyber.safetensors',weight:0.6}],unleashedOn:false,unleashedWeight:1};
    const DEF={model:'',prompt:'',aspect:'3:2',megapixels:1,batch:1,seed:0,refOn:true,refBoost:2.1,refBoostB:1,loraOn:true,loras:[],unleashedOn:true,unleashedWeight:1};
    const P=()=>useStore.getState().project;
    export function setup(){
      window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const files={};for(const f of ['fox.png','city.png','edit.jpg','frame.jpg','frame2.jpg','gen.png'])files[f]=pic(300,200,'#'+(f.length*111%999).toString().padStart(3,'7'));
      setMediaBase(f=>(files[f]||'data:,')+'#');
      const settings={codirEngine:'api',[codirEngineRow('api').key]:'k'};
      const api={
        getSettings:async()=>settings, moodList:async()=>[], projectRecents:async()=>[], imageGenFolders:async()=>[], setSettings:async(p)=>Object.assign(settings,p), editorsList:async()=>[],
        imageGenStatus:async()=>({engine:true,essentials:true,pack:true,official:['krea-2-quality'],civit:[]}),
        imageGenLoras:async()=>[{root:'r',rel:'KREA 2/cyber.safetensors',file:'cyber.safetensors',name:'cyber',bytes:1,triggerWords:[]}],
        imageGenReadPng:async(f)=>f==='city.png'?{ok:true,settings:{source:'comfy',prompt:'neon city at night',loras:[{name:'loras/cyber.safetensors',weight:0.8},{name:'missing_one.safetensors',weight:1}],width:1536,height:1024,seed:5}}:{ok:true,settings:{source:'none',prompt:'',loras:[]}},
        imageGenNew:async(name,recipe)=>{const g={id:'g'+(++n),name:name||'image gen '+((P().imageGens||[]).length+1),recipe:{...DEF,...(recipe||{})},takes:[]};return {delta:{imageGens:[g]},imageGenId:g.id}},
        imageGenSet:async(id,patch)=>{const g=P().imageGens.find(x=>x.id===id);return {imageGens:[{...g,...(patch.name?{name:patch.name}:{}),recipe:{...g.recipe,...(patch.recipe||{})}}]}},
        codirSay:async(text,ask,imageIds)=>({codir:{...P().codir,log:[...P().codir.log,{role:'assistant',text,at:1,...(ask?{ask}:{}),...(imageIds?{imageIds}:{})}]}}),
        // the model stands in here: it read the image and set the open card's prompt (set_image_gen_prompt)
        codirSend:async(a)=>{sent.push(a);const g=P().imageGens.find(x=>x.id===a.openImageGenId);return {ok:true,reply:'done',logDelta:{codir:{...P().codir,log:[...P().codir.log,{role:'user',text:a.text,at:2},{role:'assistant',text:'wrote it',at:2}]},...(g?{imageGens:[{...g,recipe:{...g.recipe,prompt:'a quiet street at dusk, wet asphalt'}}]}:{})}}}
      };
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const host=document.getElementById('root');host.style.cssText='width:1500px;height:900px;display:flex';
      const project={dir:'synthetic',name:'T',clips:[],videos:[],audio:[],styles:[],timelines:[],folders:[],charSheets:[],scoreClips:[],voiceClips:[],codir:{log:[],brief:''},
        images:[{id:'im1',title:'@fox_t1',file:'fox.png',genPrompt:'a red fox in snow, trigger'},{id:'im2',title:'@city',file:'city.png'},{id:'im3',title:'@edit',file:'edit.jpg',editedFrom:'im1',genPrompt:'make it night'},{id:'im4',title:'@frame',file:'frame.jpg',genPrompt:'live first frame · shot 1 (instance 1)'},{id:'im5',title:'@frame2',file:'frame2.jpg'}],
        imageGens:[{id:'g0',name:'fox',recipe:{...SNAP,prompt:'something else now'},takes:[{id:'t1',file:'gen.png',createdAt:1,seed:777,width:832,height:1248,promptSent:'a red fox in snow, trigger',snapshot:SNAP,keptImageId:'im1'}]}],
        editSessions:[{id:'es',rootImageId:'im1',nodes:[{id:'e1',parentId:null,file:'edit.jpg',prompt:'make it night',refIds:[],createdAt:1,keptImageId:'im3'}]}],videoEditSessions:[]};
      useStore.setState({project,refreshSpend:async()=>{},editorImageGenId:null,libOrder:['images','videos','music'],libCollapsed:[]});
      createRoot(host).render(<>
        <div style={{width:420,display:'flex',flexDirection:'column'}}><LibraryPanel/></div>
        <div style={{width:680,display:'flex',flexDirection:'column'}}><ImageGenPanel/></div>
        <div style={{width:400,display:'flex',flexDirection:'column'}}><CoDirectorPanel/></div>
        <Toasts/>
      </>);
    }
    const mid=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}};
    export function entry(t){const els=[...document.querySelectorAll('div,span,button')].filter(e=>e.textContent.includes(t)&&![...e.children].some(c=>c.textContent.includes(t))&&e.getBoundingClientRect().width>0);return mid(els.pop())}
    export const tile=id=>mid(document.querySelector('[data-tile][data-nav="'+id+'"]'));
    export function gen(){const s=useStore.getState(),g=(P().imageGens||[]).find(x=>x.id===s.editorImageGenId);return JSON.stringify({count:P().imageGens.length,open:s.editorImageGenId,recipe:g&&g.recipe,box:document.querySelector('textarea[placeholder^="describe"]')?.value??null})}
    export const lastSay=()=>JSON.stringify(P().codir.log.slice(-1)[0]||null);
    export const yesBtn=()=>mid([...document.querySelectorAll('.btn')].find(b=>b.textContent.trim()==='yes'));
    export const has=t=>document.body.textContent.includes(t);
    export const sentJson=()=>JSON.stringify(sent.map(a=>({text:a.text,imageIds:a.imageIds,open:a.openImageGenId})));
    export const toastText=()=>{const t=document.body.textContent,i=t.indexOf('left out');return i<0?'':t.slice(i,i+160)};
    export const codirBox=()=>mid(document.querySelector('textarea[placeholder^="direct me"]'));
    export const errs=()=>errors.join(' | ');
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, loader: { '.png': 'dataurl', '.css': 'empty' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 120000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l)).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1500, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    const js = (s) => win.webContents.executeJavaScript(s)
    await js(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.setup()')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const check = (v, m) => { if (!v) throw Error(m) }
    const c = (s) => js('checks.' + s)
    const ev = async (type, x, y, o = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: o.button || 'left', clickCount: 1 }); await wait(40) }
    const click = async (p, o = {}) => { check(p, 'nothing to click'); await ev('mouseMove', p.x, p.y, o); await ev('mouseDown', p.x, p.y, o); await ev('mouseUp', p.x, p.y, o); await wait(300) }
    const makeImage = async (id) => {
      await click(await c(`tile('${id}')`), { button: 'right' })
      check(await c("has('make image')"), `${id}: the right-click menu offers make image`)
      await click(await c("entry('make image')"))
      await wait(500)
      return JSON.parse(await c('gen()'))
    }
    await wait(600)

    // 1 · saved from an Image Gen take → the whole recipe as it ran, seed random, a NEW card
    let g = await makeImage('im1')
    const want = { model: 'krea-2-quality', prompt: 'a red fox in snow', aspect: '2:3', megapixels: 1.5, batch: 2, seed: 0, refOn: false, refBoost: 2.1, refBoostB: 1, loraOn: true, loras: [{ name: 'KREA 2/cyber.safetensors', weight: 0.6 }], unleashedOn: false, unleashedWeight: 1 }
    check(g.count === 2 && g.open && g.open !== 'g0', 'take: a new card opened, the old one untouched: ' + JSON.stringify(g))
    check(JSON.stringify(g.recipe) === JSON.stringify(want), 'take: prompt, loras and every setting from the take, seed random: ' + JSON.stringify(g.recipe))
    check(g.box === 'a red fox in snow' && (await c("has('cyber')")), 'take: the card shows the prompt and the lora chip: ' + g.box)

    // 2 · PNG settings → prompt + the lora he has, size → aspect + MP; the missing lora is named
    g = await makeImage('im2')
    check(g.count === 3 && g.recipe.prompt === 'neon city at night' && JSON.stringify(g.recipe.loras) === '[{"name":"KREA 2/cyber.safetensors","weight":0.8}]', 'png: prompt + the lora from his folders: ' + JSON.stringify(g.recipe))
    check(g.recipe.aspect === '3:2' && g.recipe.megapixels === 1.5 && g.recipe.seed === 0, 'png: 1536×1024 → 3:2 at 1.5 MP, seed random: ' + JSON.stringify(g.recipe))
    check(/missing_one/.test(await c('toastText()')), 'png: the lora not in his folders is named: ' + (await c('toastText()')))

    // 3 · an Image Editor render → its prompt
    g = await makeImage('im3')
    check(g.count === 4 && g.recipe.prompt === 'make it night' && g.box === 'make it night', 'image editor: its prompt fills the card: ' + JSON.stringify(g))
    check(!(await c('lastSay()')).includes('ask'), 'with prompt data the Co-Director stays quiet')

    // 4 · no prompt data (a live frame's label is not a prompt) → the card on its defaults + the ask
    g = await makeImage('im4')
    check(g.count === 5 && g.recipe.prompt === '' && g.box === '', 'none: a new card on its defaults: ' + JSON.stringify(g))
    const say = JSON.parse(await c('lastSay()'))
    check(say.role === 'assistant' && /@frame has no prompt data/.test(say.text) && /Want me to fill it in\? I'll look at the image and write the prompt and aspect straight into that card\./.test(say.text) && say.ask && JSON.stringify(say.imageIds) === '["im4"]', 'none: the Co-Director says it and asks: ' + JSON.stringify(say))
    check(await c("has('@frame has no prompt data')"), 'none: the question shows in the Co-Director chat')
    check(await c('yesBtn()'), 'none: a yes button under the question')
    await click(await c('yesBtn()'))
    await wait(400)
    let s = JSON.parse(await c('sentJson()'))
    check(s.length === 1 && /^yes, go: look at @frame and write a prompt into the image gen "image gen 5" that makes an image like it, and set its aspect to match\. Write them straight in, no need to check with me first/.test(s[0].text) && s[0].imageIds.includes('im4') && s[0].open === g.open, 'yes: the whole ask goes, the image rides, the new card is the open one: ' + JSON.stringify(s))
    g = JSON.parse(await c('gen()'))
    check(g.box === 'a quiet street at dusk, wet asphalt', 'yes: the prompt it writes lands in that card: ' + JSON.stringify(g))
    check(!(await c('yesBtn()')), 'answered: the yes button goes')

    // 5 · typed "yes" does the same
    g = await makeImage('im5')
    await click(await c('codirBox()'))
    for (const ch of 'yes') { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(30) }
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await wait(500)
    s = JSON.parse(await c('sentJson()'))
    check(s.length === 2 && /^yes, go: look at @frame2 and write a prompt into the image gen "image gen 6"/.test(s[1].text) && s[1].imageIds.includes('im5'), 'typed yes: sends the whole ask with the image: ' + JSON.stringify(s[1]))
    const errs = await c('errs()'); check(!errs, 'no errors: ' + errs)
    console.log('PASS make image: a new Image Gen card from the take recipe (seed random), from PNG settings (his loras, size → aspect + MP, the missing lora named), from the Image Editor prompt; none = defaults + the Co-Director asks, yes (button or typed) sends the ask with the image and the prompt lands in that card')
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
