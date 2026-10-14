// Image Editor crop = Photoshop's crop (his call 2026-10-14: "we should be able to drag the edges of
// the crop"). The real panel and stylesheet in hidden Electron, driven by REAL mouse and keyboard
// input (sendInputEvent): edges and corners move the box's sides, Shift keeps its shape, dragging
// inside moves it, the wheel zooms it around the cursor, Esc cancels, Enter applies the box's own
// pixels at their own size; a failed save keeps the crop, a double apply saves once, the result
// becomes primary. Before this, the handles only zoomed the picture behind a fixed frame and an
// inward edge drag did nothing (shown by real input: 100% after -120 px).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-image-crop-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ImageEditorPanel} from '${ui}/panels/ImageEditor';
    import {useStore} from '${ui}/store';import {setVidancerApi} from '${ui}/api';import {setMediaBase} from '${ui}/media';
    import {fullCropBox,resizeCropBox,moveCropBox,zoomCropBox,cropPixels} from '${ui}/lib/imageCrop';
    const tick=()=>new Promise(r=>setTimeout(r,40));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const near=(a,b)=>Math.abs(a-b)<1e-6;
    let saved=[],fail=false,files={};
    export function math(){
      const F=fullCropBox(300,200);
      let b=resizeCropBox(F,300,200,'e',-90,0);check(b.x===0&&b.w===210&&b.h===200,'e inward moves the right side');
      b=resizeCropBox(F,300,200,'w',90,0);check(b.x===90&&b.w===210,'w inward moves the left side');
      b=resizeCropBox(F,300,200,'n',0,60);check(b.y===60&&b.h===140&&b.w===300,'n inward moves the top only');
      b=resizeCropBox(resizeCropBox(F,300,200,'se',-100,-100),300,200,'se',500,500);check(b.w===300&&b.h===200,'outward stops at the picture');
      check(resizeCropBox(F,300,200,'e',-1000,0).w===16,'a crop never goes below 16 px');
      b=resizeCropBox(F,300,200,'se',-90,-10,true);check(near(b.w/b.h,1.5)&&b.x===0&&b.y===0&&Math.abs(b.w-300*(1-29000/130000))<1e-6,'Shift corner keeps the shape from the far corner, following the drag along the diagonal: '+JSON.stringify(b));
      b=resizeCropBox(F,300,200,'e',-90,0,true);check(near(b.w,210)&&near(b.h,140)&&near(b.y,30),'Shift side keeps the shape around the middle');
      b=moveCropBox({x:0,y:0,w:210,h:140},300,200,9999,9999);check(b.x===90&&b.y===60,'moving stays inside the picture');
      b=zoomCropBox(F,300,200,2);check(b.w===150&&b.h===100&&b.x===75&&b.y===50,'wheel in = a smaller box around the point');
      check(zoomCropBox(b,300,200,.01).w===300,'wheel out stops at the whole picture');
      const p=cropPixels({x:10.4,y:.6,w:99.7,h:300},300,200);check(p.x===10&&p.y===1&&p.w===100&&p.h===199,'pixels round inside the picture');
      return 'math';
    }
    export async function open(){
      const source=document.createElement('canvas');source.width=300;source.height=200;const ctx=source.getContext('2d');
      for(const [i,c] of ['#ff0000','#00ff00','#0000ff'].entries()){ctx.fillStyle=c;ctx.fillRect(i*100,0,100,200)}
      files={original:source.toDataURL()};setMediaBase(f=>files[f]+'#');
      setVidancerApi({onImageProgress:()=>()=>{},setSettings:async()=>{},imageCropSave:async req=>{saved.push(req);if(fail)throw Error('fixture save failure');const url=URL.createObjectURL(new Blob([req.bytes],{type:'image/png'}));files.crop=url;return {nodeId:'crop',delta:{images:[{id:'image',title:'@fixture',file:'crop'}],editSessions:[{id:'session',rootImageId:'image',originalFile:'original',primaryNodeId:'crop',nodes:[{id:'crop',parentId:null,file:'crop',prompt:req.label,refIds:[],createdAt:1}]}]}}}});
      const project={dir:'synthetic',name:'Crop',images:[{id:'image',title:'@fixture',file:'original'}],clips:[],editSessions:[],audio:[],styles:[],timelines:[],folders:[]};
      useStore.setState({project,editorImageId:'image',previewH:{...useStore.getState().previewH,imageEdit:300}});
      window.__root=createRoot(document.getElementById('root'));window.__root.render(<ImageEditorPanel/>);
      for(let i=0;i<30&&!document.querySelector('img[crossorigin]')?.naturalWidth;i++)await tick();
      // pin the panel so the 300 px fixture shows 1:1: screen pixels = image pixels
      const host=document.getElementById('root'),box=document.querySelector('img[crossorigin]').parentElement;host.style.width=(host.clientWidth-box.clientWidth+300)+'px';await tick();await tick();
      check(box.clientWidth===300&&box.clientHeight===200,'fixture at 1:1: '+box.clientWidth+'x'+box.clientHeight);
      return startCrop();
    }
    export async function startCrop(){const el=[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()==='crop');el.click();await tick();await tick();return state()}
    export function state(){
      const q=s=>document.querySelector(s),r=e=>{const x=e.getBoundingClientRect();return {x:Math.round(x.x),y:Math.round(x.y),w:Math.round(x.width),h:Math.round(x.height)}};
      if(!q('[aria-label="Crop box"]'))return {open:false,status:document.body.textContent.slice(0,300)};
      const hs={};for(const h of ['nw','n','ne','e','se','s','sw','w']){const el=q('[aria-label="Crop '+h+' handle"]'),hr=el.getBoundingClientRect(),cx=hr.x+hr.width/2,cy=hr.y+hr.height/2;hs[h]={c:[Math.round(cx),Math.round(cy)],top:document.elementFromPoint(cx,cy)===el}}
      const b=r(q('[aria-label="Crop box"]'));return {open:true,size:q('[aria-label="Crop size"]')?.textContent,box:b,mid:[b.x+b.w/2,b.y+b.h/2],h:hs};
    }
    export function setFail(v){fail=v;return state()}
    export function saves(){return {n:saved.length,failShown:document.body.textContent.includes('fixture save failure')}}
    export async function apply(failIt,twice){fail=failIt;const el=()=>[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()==='apply');el().click();if(twice)el()?.click();await tick();await tick();return {saves:saved.length,open:!!document.querySelector('[aria-label="Crop box"]'),failShown:document.body.textContent.includes('fixture save failure')}}
    export async function result(){
      const img=new Image();img.src=files.crop;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);
      const px=(a,b)=>[...x.getImageData(a,b,1,1).data].slice(0,3).join(',');
      return {w:img.naturalWidth,h:img.naturalHeight,left:px(5,100),right:px(img.naturalWidth-5,100),label:saved.at(-1).label,primary:useStore.getState().project.editSessions[0]?.primaryNodeId};
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); if (r.error) console.error(r.error); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]; app.setPath('userData', path.join(tmp, 'profile'))
  const assert = (ok, msg) => { if (!ok) throw Error(msg) }
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
      win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
      await win.loadURL('data:text/html,<div id="root" style="height:100vh"></div>')
      await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8') + '\n' + fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8'))
      const page = async (js) => JSON.parse(JSON.stringify(await win.webContents.executeJavaScript(js)))
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const send = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...extra })
      const drag = async ([x, y], dx, dy, shift = false) => {
        const mods = shift ? ['shift'] : []
        send('mouseMove', x, y, { modifiers: mods }); await wait(20)
        send('mouseDown', x, y, { button: 'left', clickCount: 1, modifiers: mods }); await wait(20)
        for (let i = 1; i <= 8; i++) { send('mouseMove', x + (dx * i) / 8, y + (dy * i) / 8, { modifiers: [...mods, 'leftButtonDown'] }); await wait(15) }
        send('mouseUp', x + dx, y + dy, { button: 'left', clickCount: 1, modifiers: mods }); await wait(100)
        return page('checks.state()')
      }
      const key = async (k) => { send('keyDown', 0, 0, { keyCode: k }); send('keyUp', 0, 0, { keyCode: k }); await wait(120) }
      const done = []

      done.push(await page('checks.math()'))
      let s = await page('checks.open()')
      assert(s.open && s.size === '300 × 200', 'crop opens on the whole picture: ' + JSON.stringify(s))
      assert(Object.values(s.h).every((h) => h.top), 'every handle is on top under the mouse: ' + JSON.stringify(s.h))
      const img = s.box
      s = await drag(s.h.e.c, -90, 0)
      assert(s.size === '210 × 200' && s.box.x === img.x && s.box.w === 210, 'dragging the right edge in moves it: ' + JSON.stringify(s))
      assert(s.h.e.c[0] === img.x + 210, 'the right handle follows the edge: ' + s.h.e.c)
      s = await drag(s.h.n.c, 0, 60)
      assert(s.size === '210 × 140' && s.box.y === img.y + 60, 'dragging the top edge down moves it: ' + JSON.stringify(s))
      s = await drag(s.mid, 1000, 1000)
      assert(s.box.x === img.x + 90 && s.box.y === img.y + 60 && s.size === '210 × 140', 'dragging inside moves the box, kept inside the picture: ' + JSON.stringify(s))
      s = await drag(s.h.se.c, -60, -10, true)
      const [sw, sh] = s.size.split(' × ').map(Number)
      assert(Math.abs(sw / sh - 1.5) < 0.02 && s.box.x === img.x + 90 && s.box.y === img.y + 60, 'Shift keeps the shape from the far corner: ' + JSON.stringify(s))
      s = await drag(s.h.w.c, 40, 0)
      assert(s.box.x + s.box.w === img.x + 90 + sw, 'the right side stays when the left is dragged: ' + JSON.stringify(s))
      // wheel: zooms around the cursor and keeps the box's shape
      const before = s
      send('mouseWheel', before.mid[0], before.mid[1], { deltaX: 0, deltaY: 120, wheelTicksX: 0, wheelTicksY: 1, canScroll: true }); await wait(150)
      s = await page('checks.state()')
      const [bw, bh] = before.size.split(' × ').map(Number), [aw, ah] = s.size.split(' × ').map(Number)
      assert(aw !== bw && Math.abs(aw / ah - bw / bh) < 0.05, 'the wheel resizes the box and keeps its shape: ' + before.size + ' → ' + s.size)
      await key('Escape')
      s = await page('checks.state()')
      assert(!s.open, 'Esc cancels the crop')
      // a real crop: the left two stripes (red, green), applied with Enter after a failed save
      s = await page('checks.startCrop()')
      s = await drag(s.h.e.c, -100, 0)
      assert(s.size === '200 × 200', 'second crop: ' + s.size)
      await page('checks.setFail(true)')
      await key('Return')
      s = await page('checks.state()')
      const f = await page('checks.saves()')
      assert(s.open && f.n === 1 && f.failShown, 'Enter applies; a failed save keeps the crop open to try again: ' + JSON.stringify(f))
      const a = await page('checks.apply(false,true)')
      assert(a.saves === 2 && !a.open, 'apply pressed twice saves once and closes the crop: ' + JSON.stringify(a))
      const out = await page('checks.result()')
      assert(out.w === 200 && out.h === 200, 'the result is the box’s own size: ' + out.w + 'x' + out.h)
      assert(out.left === '255,0,0' && out.right === '0,255,0', 'the result holds the cropped pixels: ' + out.left + ' / ' + out.right)
      assert(out.label === 'crop · 200×200 · 0, 0', 'label: ' + out.label)
      assert(out.primary === 'crop', 'the crop becomes primary')
      done.push('real-input edges, inside drag, Shift, wheel, Esc, Enter, failed save, one save, size, pixels, primary')
      console.log('PASS ' + done.join(' · '))
      app.exit(0)
    } catch (e) { console.error(e); app.exit(1) }
  })
}
