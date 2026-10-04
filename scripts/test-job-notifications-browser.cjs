// Real Co-Director panel, house CSS and mouse/keyboard input, in an isolated Electron profile.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-job-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { CoDirectorPanel } from '${ui}/panels/CoDirector'; import { useStore } from '${ui}/store'; import { setVidancerApi } from '${ui}/api';
    const W=window; W.errors=[]; W.sent=[]; W.stops=0;
    W.addEventListener('error', e=>W.errors.push(e.message)); W.addEventListener('unhandledrejection',e=>W.errors.push(String(e.reason)));
    const tick=()=>new Promise(r=>setTimeout(r,100));
    const plan={id:'plan',revision:'shown-revision',text:'Make 21 pictures. Inspect them, write their story, then make the clips.',progress:'',status:'draft',renders:[{kind:'image_gen',engine:'any-image-model',maxJobs:22,settings:{'recipe.batch':1},cost:'local GPU, no provider charge'}],tools:['fire_render'],maxExchanges:4,exchanges:0,noProgress:0,aiRoute:'fake',aiCost:'fake/free',awaiting:[],version:0,seenVersion:-1};
    export async function setup(){
      setVidancerApi(new Proxy({getSettings:async()=>({anthropicKey:'fake',codirFire:true}),spendList:async()=>({entries:[],total:0}),codirSend:async r=>{W.sent.push(r); useStore.setState(s=>({codirJobs:{...s.codirJobs,plan:{...s.codirJobs.plan,status:'waiting',progress:'Waiting for pictures.'}}}));return{ok:true}},codirStopPlan:async()=>{W.stops++;useStore.setState(s=>({codirJobs:{...s.codirJobs,plan:{...s.codirJobs.plan,status:'stopped'}}}))}}, {get:(o,k)=>k in o?o[k]:String(k).startsWith('on')?()=>()=>{}:async()=>[]}));
      useStore.setState({project:{dir:'test',name:'Test',images:[],clips:[],imageGens:[],scoreClips:[],voiceClips:[],charSheets:[],styles:[],videos:[],audio:[],timelines:[],codir:{log:[],brief:''}},codirJobs:{version:1,projectDir:'test',jobs:[],plan}});
      createRoot(document.getElementById('root')).render(<CoDirectorPanel/>);await tick();
    }
    const rect=el=>{if(!el)throw Error('Control missing'); const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}};
    export const input=()=>rect(document.querySelector('textarea'));
    export const button=text=>rect([...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()===text));
    export const text=()=>document.body.innerText;
    export const sent=()=>W.sent;
    export const stops=()=>W.stops;
    export const errors=()=>W.errors;
    export async function failure(){useStore.setState(s=>({codirJobs:{...s.codirJobs,plan:{...s.codirJobs.plan,status:'blocked',reason:'One job never returned. Its state is unknown.'},jobs:[{id:'lost',planId:'plan',label:'Picture 3',engine:'test',status:'lost',outputs:[],error:'Deadline exceeded'}]}}));await tick()}
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root" style="height:100vh"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (r.error) throw r.error
  process.stdout.write(r.stdout || ''); if (r.status !== 0) process.stderr.write(r.stderr || ''); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 720, height: 900, webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false } })
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    const js = s => win.webContents.executeJavaScript(s), wait = () => new Promise(r => setTimeout(r, 150))
    await js(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.setup()')
    const click = async rect => { const x=Math.round(rect.x), y=Math.round(rect.y); for(const type of ['mouseMove','mouseDown','mouseUp']) win.webContents.sendInputEvent({type,x,y,button:'left',clickCount:1}); await wait() }
    assert.match(await js('checks.text()'), /Review the plan, then send GO/)
    assert.match(await js('checks.text()'), /any-image-model/)
    await click(await js('checks.input()'))
    for(const keyCode of 'GO') win.webContents.sendInputEvent({type:'char',keyCode})
    await wait(); await click(await js('checks.button("send")'))
    assert.deepEqual((await js('checks.sent()'))[0].planApproval,{id:'plan',revision:'shown-revision'})
    assert.match(await js('checks.text()'), /Co-Di plan: waiting/)
    await click(await js('checks.button("Stop plan")'))
    assert.equal(await js('checks.stops()'),1); assert.match(await js('checks.text()'), /Co-Di plan: stopped/)
    await js('checks.failure()'); assert.match(await js('checks.text()'), /One job never returned/)
    assert.deepEqual(await js('checks.errors()'),[])
    fs.writeFileSync(path.join(tmp,'job-status.png'),(await win.webContents.capturePage()).toPNG())
    console.log('PASS real Co-Director panel: displayed approval revision, GO, Stop and lost-job report; no renderer errors')
    console.log('UI evidence: '+path.join(tmp,'job-status.png'));app.exit(0)
  }catch(e){console.error(e);app.exit(1)}})
}
