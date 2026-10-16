// list 54 (2026-09-30) — the MOODS fold hands a skill to the Co-Director. ⇪ add (or a drop) of a
// .vmd installs it as before; a skill (.md, folder, .zip, .skill) becomes one message to the
// Co-Director with its path, who opens it, reads it and adds it. The real fold and the real store,
// offscreen Electron, the app's API mocked: nothing is sent anywhere.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-mood-fold-'))
  const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MoodFold} from '${ui}/ui/MoodFold';
    import {useStore} from '${ui}/store';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const sends=[],imports=[];let picked={slugs:[],errors:[],skills:[]},lists=0;
      const api={moodList:async()=>{lists++;return []},moodImport:async()=>picked,moodImportPaths:async p=>{imports.push(p);return picked},codirSend:async a=>{sends.push(a);return {ok:true,reply:'done'}}};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      useStore.setState({project:{dir:'synthetic',images:[],codir:{log:[],moodsPinned:[]}},refreshSpend:async()=>{},codirQueue:[],moodsFoldOpen:true});
      createRoot(document.getElementById('root')).render(<MoodFold/>);await tick(300);
      // the button is looked up fresh each time: the fold re-renders when a skill opens it
      const btn=()=>[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()==='⇪ add');
      const add={click:()=>btn().click(),get title(){return btn()?.title}};
      check(btn()&&/the Co-Director opens a skill, reads it and adds it to the set/.test(add.title),'the add button says who takes a skill in: '+add?.title);

      // a .vmd: installed, nothing for the Co-Director
      picked={slugs:['quiet-noir'],errors:[],skills:[]};add.click();await tick(200);
      check(sends.length===0,'a .vmd is not the Co-Director’s job');
      // an older main (no skills field yet): nothing breaks, nothing is sent
      picked={slugs:[],errors:[]};add.click();await tick(200);
      check(sends.length===0&&!errors.length,'an older core: '+errors.join(' | '));

      // one skill zip: one message, its path in it
      picked={slugs:[],errors:[],skills:['C:\\\\Users\\\\me\\\\Desktop\\\\mangaka-council.zip']};
      const before=lists;add.click();await tick(300);
      check(sends.length===1,'one message to the Co-Director: '+sends.length);
      const t=sends[0].text;
      check(t.startsWith('(app: the user added a skill to the MOODS fold — that is their ok to import.'),'the app line opens it: '+t.slice(0,90));
      check(/read_skill it, then import_skill it with a header you write/.test(t)&&/ask before replacing/.test(t),'it says how');
      check(t.endsWith('Import this skill as a MOOD:\\nC:\\\\Users\\\\me\\\\Desktop\\\\mangaka-council.zip'),'the path rides in the user’s own message: '+t.slice(-80));
      check(lists>before,'the fold re-reads its list');

      // two at once: both paths, one message
      picked={slugs:[],errors:['fake.exe: not a .vmd, or a skill (.md, folder, .zip, .skill)'],skills:['D:\\\\skills\\\\a.zip','D:\\\\skills\\\\folder-skill']};
      add.click();await tick(300);
      check(sends.length===2&&sends[1].text.endsWith('Import these skills as a MOOD:\\nD:\\\\skills\\\\a.zip\\nD:\\\\skills\\\\folder-skill'),'two skills, one message: '+sends[1]?.text.slice(-90));
      check(sends[1].text.startsWith('(app: the user added skills to the MOODS fold'),'plural');
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'MOODS fold: a .vmd installs as before; a skill goes to the Co-Director in one message with its path; an older core is safe';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 700, height: 500, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
