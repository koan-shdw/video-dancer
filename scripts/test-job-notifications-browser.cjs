// Real Co-Director panel, house CSS and mouse/keyboard input, in an isolated Electron profile.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-job-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  // Run the app's actual subscription, preload and saved records. Injecting codirJobs directly
  // missed a stale backend whose unscoped notifications were discarded by the renderer.
  const appSource = fs.readFileSync(path.join(ui, 'App.tsx'), 'utf8')
  const subscription = appSource.match(/  useEffect\(\(\) => \{\r?\n    let alive = true[\s\S]*?\}, \[projDirForNotice\]\)/)?.[0]
  assert.ok(subscription, 'App job-state subscription must be exercised')
  for (const [entry, output] of [['src/preload/index.ts', 'preload.cjs'], ['src/main/jobNotifications.ts', 'jobs.cjs']]) {
    require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '..', entry)], outfile: path.join(tmp, output), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  }
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React, { useEffect } from 'react'; import { createRoot } from 'react-dom/client';
    import { CoDirectorPanel } from '${ui}/panels/CoDirector'; import { useStore } from '${ui}/store'; import { setVidancerApi, vd } from '${ui}/api';
    const W=window; W.errors=[];
    W.addEventListener('error', e=>W.errors.push(e.message)); W.addEventListener('unhandledrejection',e=>W.errors.push(String(e.reason)));
    const tick=()=>new Promise(r=>setTimeout(r,100));
    function Harness(){const projDirForNotice=useStore(s=>s.project?.dir); ${subscription}; return <CoDirectorPanel/>}
    export async function setup(dir){
      setVidancerApi(W.vidancer);
      useStore.setState({project:{dir,name:'Test',images:[],clips:[],imageGens:[],scoreClips:[],voiceClips:[],charSheets:[],styles:[],videos:[],audio:[],timelines:[],codir:{log:[],brief:''}},codirJobs:null});
      createRoot(document.getElementById('root')).render(<Harness/>);await tick();
    }
    const rect=el=>{if(!el)throw Error('Control missing'); const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}};
    export const input=()=>rect(document.querySelector('textarea'));
    export const button=text=>rect([...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()===text));
    export const text=()=>document.body.innerText;
    export const plan=()=>useStore.getState().codirJobs?.plan;
    export const errors=()=>W.errors;
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root" style="height:100vh"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (r.error) throw r.error
  process.stdout.write(r.stdout || ''); if (r.status !== 0) process.stderr.write(r.stderr || ''); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow, ipcMain } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 720, height: 900, webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(tmp, 'preload.cjs'), offscreen: true, backgroundThrottling: false } })
    const dir = path.join(tmp, 'project'); fs.mkdirSync(dir)
    const plan={id:'plan',revision:'shown-revision',text:'Make 21 pictures. Inspect them, write their story, then make the clips.',progress:'',status:'draft',renders:[{kind:'image_gen',engine:'any-image-model',maxJobs:22,settings:{'recipe.batch':1},cost:'local GPU, no provider charge'}],tools:['fire_render'],maxExchanges:4,exchanges:0,noProgress:0,aiRoute:'fake',aiCost:'fake/free',awaiting:[],version:0,seenVersion:-1}
    // Existing project records predate the projectDir envelope. read() must attach it.
    fs.writeFileSync(path.join(dir, 'codir-jobs.json'), JSON.stringify({version:1,jobs:[],plan}))
    const { JobNotifications } = require(path.join(tmp, 'jobs.cjs'))
    const records = new JobNotifications({projectDir:()=>dir,enabled:async()=>true,notify:(_dir,state)=>win.webContents.send('jobs:state',state),cancel:async()=>{},recover:async()=>[]})
    const sent=[]; let stops=0
    ipcMain.handle('jobs:state',()=>records.read())
    ipcMain.handle('settings:get',()=>({anthropicKey:'fake',codirFire:true}))
    ipcMain.handle('spend:list',()=>({entries:[],total:0}))
    ipcMain.handle('mood:list',()=>[])
    ipcMain.handle('codir:models',()=>[])
    ipcMain.handle('codir:send',async(_e,r)=>{sent.push(r); await records.approve(r.planApproval?.id,r.planApproval?.revision,'fake'); const s=await records.read();s.plan.status='waiting';s.plan.progress='Waiting for pictures.';await records.save(dir);return{ok:true}})
    ipcMain.handle('codir:stopPlan',async()=>{stops++;await records.stop()})
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    const js = s => win.webContents.executeJavaScript(s), wait = () => new Promise(r => setTimeout(r, 150))
    await js(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.setup('+JSON.stringify(dir)+')')
    const click = async rect => { const x=Math.round(rect.x), y=Math.round(rect.y); for(const type of ['mouseMove','mouseDown','mouseUp']) win.webContents.sendInputEvent({type,x,y,button:'left',clickCount:1}); await wait() }
    assert.match(await js('checks.text()'), /Review the plan, then send GO/)
    assert.match(await js('checks.text()'), /any-image-model/)
    win.webContents.send('jobs:state',{version:1,projectDir:'another-project',jobs:[],plan:{...plan,revision:'wrong-project'}}); await wait()
    assert.equal((await js('checks.plan()')).revision,'shown-revision','ignore another project’s notification')
    const state=await records.read();state.plan.revision='updated-revision';await records.save(dir);await wait()
    assert.equal((await js('checks.plan()')).revision,'updated-revision','saved plan updates reach the panel through IPC')
    await assert.rejects(records.approve(plan.id,'shown-revision','fake'),/changed/)
    await click(await js('checks.input()'))
    for(const keyCode of 'GO') win.webContents.sendInputEvent({type:'char',keyCode})
    await wait(); await click(await js('checks.button("send")'))
    assert.deepEqual(sent[0].planApproval,{id:'plan',revision:'updated-revision'})
    assert.match(await js('checks.text()'), /Co-Di plan: waiting/)
    await click(await js('checks.button("stop plan")'))
    assert.equal(stops,1); assert.equal((await js('checks.plan()')).status,'stopped')
    assert.doesNotMatch(await js('checks.text()'), /Co-Di plan:|Make 21 pictures|Plan, progress and results/)
    state.plan.status='blocked';state.plan.reason='One job never returned. Its state is unknown.';await records.save(dir);await wait()
    assert.match(await js('checks.text()'), /One job never returned/)
    assert.deepEqual(await js('checks.errors()'),[])
    fs.writeFileSync(path.join(tmp,'job-status.png'),(await win.webContents.capturePage()).toPNG())
    console.log('PASS saved plan through real preload and App subscription: project isolation, updated approval revision, GO, Stop and lost-job report; no renderer errors')
    console.log('UI evidence: '+path.join(tmp,'job-status.png'));app.exit(0)
  }catch(e){console.error(e);app.exit(1)}})
}
