// 10-11 (his call: both editors in Image Gen's frame, Clip Gen's grammar) — real input
// (webContents.sendInputEvent) and the house CSS: the Video Editor and the Image Editor each show
// the Model and Prompt cards, Generate pinned to the panel's bottom, the take tree as cards in the
// right sidebar (T1, T2… under "from original" / "from T1"); a click on a card selects it and the
// preview label + hero follow; right-click opens the editor's own menu (the Image Editor's old row
// buttons ◉ / save / delete live there now); a whole-video window shows no amber and no ↔ pill.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-editor-layout-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoEditorPanel} from '${ui}/panels/VideoEditor'; import {ImageEditorPanel} from '${ui}/panels/ImageEditor';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api'; import {setMediaBase} from '${ui}/media';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms));
    let root, host, errors=[];
    const pic=(w,h,c)=>{const k=document.createElement('canvas');k.width=w;k.height=h;const x=k.getContext('2d');x.fillStyle=c;x.fillRect(0,0,w,h);return k.toDataURL()};
    export function setup(){
      window.addEventListener('error',e=>errors.push(String(e.message)));
      const files={orig:pic(320,180,'#c33'),t1:pic(320,180,'#3c3'),t2:pic(320,180,'#33c'),img:pic(200,300,'#888'),e1:pic(200,300,'#aaa')};
      setMediaBase(f=>(files[f]||'data:,')+'#');
      setVidancerApi(new Proxy({editorsList:async()=>[]},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      host=document.getElementById('root');host.style.cssText='width:1000px;height:900px;display:flex;flex-direction:column';
      root=createRoot(host);
    }
    export async function show(kind){
      const project={dir:'synthetic',name:'T',images:[{id:'im',title:'@robot',file:'img'}],clips:[],videos:[{id:'v',title:'@vid',file:'orig',durationSec:8}],audio:[],styles:[],timelines:[],folders:[],
        editSessions:[{id:'es',rootImageId:'im',originalFile:'img',primaryNodeId:'e1',nodes:[{id:'e1',parentId:null,file:'e1',prompt:'remove design from tshirt',refIds:[],createdAt:1}]}],
        videoEditSessions:[{id:'vs',rootVideoId:'v',nodes:[{id:'n1',parentId:null,file:'t1',prompt:'make the lasers move',engine:'omniflash11',durationSec:8,createdAt:1},{id:'n2',parentId:'n1',file:'t2',prompt:'make it night',engine:'omniflash11',durationSec:8,createdAt:2}]}]};
      useStore.setState({project,editorVideoRoot:{videoId:'v'},editorImageId:'im'});
      root.render(<div style={{flex:1,minHeight:0,display:'flex'}}>{kind==='video'?<VideoEditorPanel/>:<ImageEditorPanel/>}</div>);
      await tick(500);
    }
    const mid=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}};
    export const spot=id=>mid(document.querySelector('[data-take="'+id+'"]'));
    const amber=()=>{const s=document.createElement('span');s.style.color='var(--amber)';document.body.appendChild(s);const c=getComputedStyle(s).color;s.remove();return c};
    export const selected=id=>getComputedStyle(document.querySelector('[data-take="'+id+'"]')).borderTopColor===amber();
    const hero=()=>[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('Generate now'));
    export function layout(){
      const h=hero(),hr=h&&h.getBoundingClientRect(),hb=host.getBoundingClientRect();
      return JSON.stringify({
        cards:[...document.querySelectorAll('[data-fold]')].map(e=>e.textContent.replace(/[▾▸]/g,'').trim()),
        hero:h?h.textContent:'',heroGap:hr?Math.round(hb.bottom-hr.bottom):-1,
        side:[...document.querySelectorAll('.lb')].map(e=>e.textContent.replace('›','').trim()).filter(t=>/editor/.test(t)),
        takes:[...document.querySelectorAll('[data-take]')].map(e=>e.getAttribute('data-take')),
        marks:[...document.querySelectorAll('[data-take]')].map(e=>e.textContent.includes('◉')),
        froms:[...document.querySelectorAll('div')].filter(e=>e.childElementCount===0&&/^▾ from /.test(e.textContent)).map(e=>e.textContent),
        pill:[...document.querySelectorAll('div')].some(e=>e.textContent==='↔'),
        mode:document.querySelector('.vd-mode.on')?.textContent??null,
        label:[...document.querySelectorAll('span,div')].filter(e=>e.childElementCount===0&&e.style.fontFamily==='var(--mono)'&&e.style.position==='absolute').map(e=>e.textContent)[0]??[...document.querySelectorAll('span,div')].filter(e=>e.style.position==='absolute'&&e.style.top==='6px'&&e.style.left==='8px').map(e=>e.textContent)[0]
      });
    }
    export function entry(t){const els=[...document.querySelectorAll('div,span,button')].filter(e=>e.textContent.includes(t)&&![...e.children].some(c=>c.textContent.includes(t)));return mid(els.pop())}
    export const has=t=>document.body.textContent.includes(t);
    export const errs=()=>errors.join(' | ');
    export const menu=()=>[...document.querySelectorAll('div')].filter(d=>d.style.position==='fixed'&&d.style.zIndex==='2500').map(d=>d.textContent).join(' || ');
    export function closeMenu(){[...document.querySelectorAll('div')].find(d=>d.style.position==='fixed'&&d.style.zIndex==='2500')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))}
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 120000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l)).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    const js = (s) => win.webContents.executeJavaScript(s)
    await js(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.setup()')
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const check = (v, m) => { if (!v) throw Error(m) }
    const c = (s) => js('checks.' + s)
    const ev = async (type, x, y, o = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: o.button || 'left', clickCount: 1 }); await wait(40) }
    const click = async (p, o = {}) => { check(p, 'nothing to click'); await ev('mouseMove', p.x, p.y, o); await ev('mouseDown', p.x, p.y, o); await ev('mouseUp', p.x, p.y, o); await wait(250) }
    const esc = async () => { await c('closeMenu()'); await wait(200) } // the house menu closes on an outside press
    const L = async () => JSON.parse(await c('layout()'))

    // ---- Video Editor ----
    await c("show('video')")
    let l = await L()
    check(JSON.stringify(l.cards) === '["model","prompt"]', 'video: the Model and Prompt cards: ' + JSON.stringify(l.cards))
    check(l.hero.startsWith('▶ Generate now (adds a take under the original) · Gemini Omni Flash 1.1') && l.heroGap >= 0 && l.heroGap < 40, 'video: the hero is pinned to the bottom: ' + JSON.stringify([l.hero, l.heroGap]))
    check(l.side.includes('video editor') && JSON.stringify(l.takes) === '["original","n1","n2"]', 'video: the sidebar holds the original and T1, T2: ' + JSON.stringify([l.side, l.takes]))
    check(JSON.stringify(l.froms) === '["▾ from original","▾ from T1"]', 'video: each branch under its parent: ' + JSON.stringify(l.froms))
    check(!l.pill && l.mode === 'edit', 'video: a whole-video window shows no ↔ pill; Omni 1.1 lights edit: ' + JSON.stringify([l.pill, l.mode]))
    await click(await c("spot('n2')"))
    l = await L()
    check(await c("selected('n2')"), 'video: a click on T2 selects its card')
    check(l.hero.includes('under T2') && /^T2 · from T1/.test(l.label || ''), 'video: the hero and the preview label follow: ' + JSON.stringify([l.hero, l.label]))
    await click(await c("spot('n1')"), { button: 'right' })
    check(await c("has('bake → NEW clip')"), 'video: right-click on a card opens the bake menu')
    await esc()

    // ---- Image Editor ----
    await c("show('image')")
    l = await L()
    check(JSON.stringify(l.cards) === '["model","prompt"]', 'image: the Model and Prompt cards: ' + JSON.stringify(l.cards))
    check(l.hero.startsWith('▶ Generate now (adds a take under T1)') && l.heroGap >= 0 && l.heroGap < 40, 'image: opens on the ◉ primary T1, the hero pinned to the bottom: ' + JSON.stringify([l.hero, l.heroGap]))
    check(l.side.includes('image editor') && JSON.stringify(l.takes) === '["original","e1"]' && JSON.stringify(l.marks) === '[false,true]', 'image: the sidebar holds the original and T1 ◉: ' + JSON.stringify([l.side, l.takes, l.marks]))
    await click(await c("spot('original')"))
    l = await L()
    check(await c("selected('original')") && l.hero.includes('under the original'), 'image: a click on the original selects it: ' + l.hero)
    await click(await c("spot('e1')"), { button: 'right' })
    check((await c("has('save to Library')")) && (await c("has('delete branch')")) && (await c("has('reveal file')")), 'image: right-click on T1 = save / open in / reveal / delete')
    await esc()
    await click(await c("spot('original')"), { button: 'right' })
    check(await c("has('make primary')"), 'image: right-click on the original offers make primary: ' + (await c('menu()')) + ' sel=' + (await c("selected('original')")))
    await esc()
    const errs = await c('errs()'); check(!errs, 'no errors: ' + errs)
    console.log('PASS real input in both editors: Model + Prompt cards, Generate pinned to the bottom, the take tree as cards in the sidebar (each branch under its parent), a click selects a card and the hero + preview label follow, right-click opens the editor menu (Image Editor: ◉ / save / delete moved there), no amber or ↔ on a whole-video window')
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
