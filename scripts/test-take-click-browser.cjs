// list 2 (his rule 2026-10-03): "the only thing that should make a keeper is the tilde or right
// click". Every takes row (Clip Gen, Image Gen, Score, SFX, Voice, Sheet Gen) driven with REAL input
// (webContents.sendInputEvent) and the house CSS: a plain click selects the take and calls nothing
// that flags it; ~ flags the selected; right-click → ★ keeper flags. The app's API is a mock that
// records every keeper call.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-take-click-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RenderPanel} from '${ui}/panels/RenderPanel';
    import {ImageGenPanel} from '${ui}/panels/ImageGen';
    import {ScoreCardPanel} from '${ui}/panels/ScoreCard';
    import {SfxCardPanel} from '${ui}/panels/SfxCard';
    import {VoicesCardPanel} from '${ui}/panels/VoicesCard';
    import {SheetGenPanel} from '${ui}/panels/SheetGen';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms));
    const W=window;W.__errors=[];W.__keeper=[];
    let root;
    const recipe={prompt:'x',model:'krea-2-quality',aspect:'1:1',megapixels:1,batch:1,seed:0,refOn:false,refBoost:2.1,refBoostB:1,loraOn:false,loras:[],unleashedOn:false,unleashedWeight:1};
    const vtake=(id)=>({id,file:id+'.mp4',createdAt:0,durationSec:4,engine:'seedance2'});
    const atake=(id)=>({id,file:id+'.wav',createdAt:0,durationSec:3});
    const itake=(id)=>({id,file:id+'.png',createdAt:0,seed:1,width:8,height:8,promptSent:'x',snapshot:recipe});
    const pd={engine:'seedance2',mode:'ref2v',freeform:'',scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'4',resolution:'720p',aspectRatio:'auto',generateAudio:true};
    const ROWS={
      clip:{panel:RenderPanel,ids:['c1','c2','c3'],state:{selectedClipId:'k'}},
      image:{panel:ImageGenPanel,ids:['i1','i2','i3'],state:{editorImageGenId:'g'}},
      score:{panel:ScoreCardPanel,ids:['s1','s2','s3'],state:{editorScoreId:'s'}},
      sfx:{panel:SfxCardPanel,ids:['x1','x2','x3'],state:{editorSfxId:'x'}},
      voice:{panel:VoicesCardPanel,ids:['v1','v2','v3'],state:{editorVoiceId:'v'}},
      sheet:{panel:SheetGenPanel,ids:['h1','h2','h3'],state:{selectedClipId:'sh'}}
    };
    export async function setup(){
      window.addEventListener('error',e=>W.__errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>W.__errors.push(String(e.reason)));
      const api={projectRecents:async()=>[],getSettings:async()=>({}),setSettings:async()=>true,modelsList:async()=>({rows:[]}),localStatus:async()=>({}),ltxStatus:async()=>({}),spendList:async()=>({total:0,entries:[]}),
        imageGenStatus:async()=>({engine:true,essentials:true,pack:true,official:['krea-2-quality'],civit:[]}),imageGenLoras:async()=>[],imageGenFolders:async()=>[],imageGenThumb:async()=>null,moodList:async()=>[]};
      // every keeper call, whatever its name: the old click went through setKeeper / imageGenKeeper / scoreKeeper / voiceKeeper
      setVidancerApi(new Proxy(api,{get:(t,k)=>{if(typeof k==='string'&&/keeper/i.test(k))return async(...a)=>{W.__keeper.push([k,...a]);return null};return k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}}));
      const flagged=(ids)=>({keeperIds:[ids[0]],keeperTakeId:ids[0]});
      const project={dir:'synthetic',name:'Test',
        clips:[{id:'k',name:'Kick',promptData:pd,takes:['c1','c2','c3'].map(vtake),...flagged(['c1'])},
               {id:'sh',name:'Shin',promptData:pd,sheet:{sourceImageId:'im',mode:'character'},takes:['h1','h2','h3'].map(vtake),...flagged(['h1'])}],
        images:[{id:'im',title:'@shin',file:'shin.png'}],audio:[],videos:[],charSheets:[],
        scoreClips:[{id:'s',name:'Theme',beats:[],recipe:{engine:'minimax-music-3'},takes:['s1','s2','s3'].map(atake),...flagged(['s1'])},
                    {id:'x',kind:'sfx',name:'Door',beats:[],recipe:{engine:'sonilo-sfx'},takes:['x1','x2','x3'].map(atake),...flagged(['x1'])}],
        voiceClips:[{id:'v',name:'Kai',recipe:{engine:'seed-audio-1'},takes:['v1','v2','v3'].map(atake),...flagged(['v1'])}],
        styles:[],imageGens:[{id:'g',name:'Gen',recipe,takes:['i1','i2','i3'].map(itake),...flagged(['i1'])}],
        timelines:[{id:'tl',name:'T',aspectRatio:'16:9',items:[]}],activeTimelineId:'tl',folders:[],codir:{log:[],brief:''}};
      useStore.setState({project});
      root=createRoot(document.getElementById('root'));
    }
    export async function show(kind){const r=ROWS[kind];useStore.setState(r.state);const P=r.panel;root.render(<div key={kind} style={{width:900,height:1300}}><P/></div>);await tick(500);W.__keeper=[];return kind}
    const card=id=>document.querySelector('[data-nav="'+id+'"]');
    // a spot on the card that is the card itself (not its ▶ player or its ★)
    export const spot=id=>{const el=card(id);if(!el)return null;el.scrollIntoView({block:'center'});const label=[...el.querySelectorAll('span')].find(q=>/^take [0-9]+$/.test(q.textContent.trim()));if(label){const q=label.getBoundingClientRect();return{x:q.left+q.width/2,y:q.top+q.height/2}}const r=el.getBoundingClientRect();for(const [fx,fy] of [[0.5,0.5],[0.85,0.2],[0.5,0.15],[0.9,0.9],[0.2,0.85]]){const x=r.left+r.width*fx,y=r.top+r.height*fy,hit=document.elementFromPoint(x,y);if(hit&&hit.closest('[data-nav]')===el&&!hit.closest('button,audio,[role=button],[aria-label]'))return{x,y}}return{x:r.left+r.width/2,y:r.top+r.height/2}};
    export const calls=()=>JSON.stringify(W.__keeper);
    export const clear=()=>{W.__keeper=[];return 0};
    export const selected=id=>{const el=card(id);return !!el&&getComputedStyle(el).outlineStyle==='solid'};
    export const entry=label=>{const el=[...document.querySelectorAll('div,span')].filter(d=>d.textContent.trim()===label&&d.children.length===0).pop();if(!el)return null;const r=el.getBoundingClientRect();return{x:r.left+Math.min(20,r.width/2),y:r.top+r.height/2}};
    export const errors=()=>W.__errors.join(' | ');
    export const dump=()=>document.body.innerText.slice(0,600).replace(/\s+/g,' ')+' || navs: '+[...document.querySelectorAll('[data-nav]')].map(e=>e.getAttribute('data-nav')).join(',')+' || errors: '+W.__errors.join(' | ');
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
    const win = new BrowserWindow({ show: false, width: 1000, height: 1300, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    const js = (s) => win.webContents.executeJavaScript(s)
    await js(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.setup()')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const check = (v, m) => { if (!v) throw Error(m) }
    const c = (s) => js('checks.' + s)
    const ev = async (type, x, y, o = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: o.button || 'left', clickCount: 1, modifiers: o.mods || [] }); await wait(40) }
    const click = async (p, o = {}) => { await ev('mouseMove', p.x, p.y, o); await ev('mouseDown', p.x, p.y, o); await ev('mouseUp', p.x, p.y, o); await wait(200) }
    const key = async (keyCode, mods = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods }); await wait(30); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods }); await wait(200) }
    const ROWS = { clip: ['c1', 'c2', 'c3'], image: ['i1', 'i2', 'i3'], score: ['s1', 's2', 's3'], sfx: ['x1', 'x2', 'x3'], voice: ['v1', 'v2', 'v3'], sheet: ['h1', 'h2', 'h3'] }
    for (const [kind, [, b, cc]] of Object.entries(ROWS)) {
      await c(`show('${kind}')`)
      const pb = await c(`spot('${b}')`); check(pb, kind + ': take ' + b + ' shows: ' + (await c('dump()')))
      await click(pb)
      check((await c('calls()')) === '[]', kind + ': a plain click calls nothing that flags a keeper: ' + (await c('calls()')))
      check(await c(`selected('${b}')`), kind + ': a plain click selects the take')
      await key('`')
      const tilde = JSON.parse(await c('calls()'))
      check(tilde.length === 1 && JSON.stringify(tilde[0][3]) === JSON.stringify([b]), kind + ': ~ flags the selected take: ' + JSON.stringify(tilde))
      await c('clear()')
      await click(await c(`spot('${cc}')`), { button: 'right' }); await wait(200)
      const item = await c(`entry('★ keeper')`); check(item, kind + ': right-click offers ★ keeper')
      await click(item)
      const right = JSON.parse(await c('calls()'))
      check(right.length === 1 && JSON.stringify(right[0][3]) === JSON.stringify([cc]) && right[0][4] === true, kind + ': right-click → ★ keeper flags it: ' + JSON.stringify(right))
      await key('Escape')
    }
    const errs = await c('errors()'); check(!errs, 'no errors: ' + errs)
    console.log('PASS real input on every takes row (Clip Gen, Image Gen, Score, SFX, Voice, Sheet Gen): a plain click selects the take and flags nothing; ~ flags the selected; right-click → ★ keeper flags it')
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
