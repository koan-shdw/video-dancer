// list 9 + 10 (2026-09-30) — Image Edit's VIA row: Seedream 5.0 Pro and Flash run on fal OR ModelArk,
// Nano Banana 2 and Pro on fal OR Google,
// the ModelArk row has its own sizes (2K / 1.5K / 1K) and prices, the pick is remembered per model,
// and a render carries the pick. The real panel in an offscreen Electron window (a file page, so the
// panel's localStorage memory works); the render is caught before it leaves the page.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-image-via-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ImageEditorPanel} from '${ui}/panels/ImageEditor';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api';
    const tick=(ms=60)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const dd=t=>document.querySelector('[title="'+t+'"]');
    const shown=t=>dd(t).textContent.replace('▾','').trim().split(/(?=[A-Z0-9])/).pop();
    const open=async t=>{dd(t).click();await tick();return [...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px')};
    const lab=e=>e.textContent.replace('✓','').trim();
    const optionsOf=async t=>{const els=await open(t);const out=els.map(e=>({label:lab(e),dim:e.style.color==='var(--dim)'}));document.querySelector('div[style*="inset: 0"]')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick();return out};
    const pick=async(t,label)=>{const els=await open(t);const el=els.find(e=>lab(e)===label);check(el,'option '+label+' in '+t+': '+els.map(lab).join(','));el.click();await tick()};
    const cost=()=>[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('generate now')).textContent.match(/~\\$([\\d.]+)/)[1];
    export async function run(){
      try{localStorage.clear()}catch{}
      setVidancerApi(new Proxy({},{get:(t,k)=>typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const jobs=[];
      useStore.setState({project:{dir:'synthetic',name:'T',images:[{id:'image',title:'@fixture',file:'original.png'}],clips:[],editSessions:[],audio:[],styles:[],timelines:[],folders:[]},editorImageId:'image',renderNow:j=>{jobs.push(j)},previewH:{...useStore.getState().previewH,imageEdit:200}});
      const root=createRoot(document.getElementById('root'));root.render(<div style={{width:900,height:1400}}><ImageEditorPanel/></div>);await tick(300);
      const MODEL='the model that makes the edit',VIA='who serves this model',SIZE='output size — bigger costs more';
      const models=(await optionsOf(MODEL)).map(o=>o.label);
      check(models.includes('Seedream 5.0 Pro')&&models.includes('Seedream 5.0 Flash'),'both Seedreams are offered: '+models.join(', '));
      check(!models.includes('Nano Banana'),'the retired Nano Banana is not offered');
      await pick(MODEL,'Seedream 5.0 Pro');
      const vias=await optionsOf(VIA);
      check(JSON.stringify(vias)==='[{"label":"fal","dim":false},{"label":"ModelArk","dim":false}]','Pro: fal and a live ModelArk row: '+JSON.stringify(vias));
      check(cost()==='0.135','Pro on fal at 2K = $0.135: '+cost());
      await pick(VIA,'ModelArk');
      check(JSON.stringify((await optionsOf(SIZE)).map(o=>o.label))==='["2K","1.5K","1K"]','ModelArk sizes 2K / 1.5K / 1K');
      check(cost()==='0.090','Pro on ModelArk at 2K = $0.09: '+cost());
      await pick(SIZE,'1.5K');
      check(cost()==='0.045','Pro on ModelArk at 1.5K = $0.045: '+cost());
      await pick(MODEL,'Seedream 5.0 Flash');
      check(cost()==='0.027','Flash starts on fal = $0.027: '+cost());
      await pick(VIA,'ModelArk');
      check(cost()==='0.018','Flash on ModelArk = $0.018: '+cost());
      // list 9: Nano Banana 2 and Pro straight from Google
      await pick(MODEL,'Nano Banana Pro');
      check(JSON.stringify(await optionsOf(VIA))==='[{"label":"fal","dim":false},{"label":"Google","dim":false}]','Nano Banana Pro: fal and Google');
      check(cost()==='0.150','Nano Pro on fal = $0.15: '+cost());
      await pick(VIA,'Google');
      check(cost()==='0.135','Nano Pro on Google = $0.134 + one input image: '+cost());
      await pick(MODEL,'Nano Banana 2');
      check(cost()==='0.080','Nano 2 starts on fal = $0.08: '+cost());
      await pick(VIA,'Google');
      check(cost()==='0.067','Nano 2 on Google at 1K = $0.067: '+cost());
      await pick(MODEL,'Seedream 5.0 Pro');
      check(cost()==='0.045','Pro remembers ModelArk at 1.5K: '+cost());
      // a render carries the pick
      const ta=document.querySelector('textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,'make it night');ta.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      [...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('generate now')).click();await tick(200);
      check(jobs.length===1,'one render sent: '+jobs.length);
      const p=jobs[0].payload;
      check(p.model==='seedream-5-pro'&&p.via==='ark'&&p.resolution==='1.5K','the render = Pro · ModelArk · 1.5K: '+JSON.stringify({model:p.model,via:p.via,resolution:p.resolution}));
      check(Math.abs(jobs[0].estCost-0.045)<1e-9,'its estimate = $0.045: '+jobs[0].estCost);
      root.unmount();return 'Seedream Pro + Flash on fal or ModelArk, Nano Banana 2 + Pro on fal or Google: live rows, each supplier its own sizes and price, remembered per model, the render carries it';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 1500, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
