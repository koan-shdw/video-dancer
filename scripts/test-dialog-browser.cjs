// Real Chromium focus/portal checks, with mocked settings and no provider traffic.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-dialog-test-'))
  const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({
    stdin: { contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {Modal} from '${ui}/ui/Modal'; import {hasOpenDialog} from '${ui}/ui/dialogFocus';
      import {confirmDialog} from '${ui}/prompt'; import {SetupWizard} from '${ui}/panels/SetupWizard';
      import {setVidancerApi} from '${ui}/api';
      const tick = () => new Promise(r => setTimeout(r, 40));
      const check = (ok, label) => { if (!ok) throw Error(label); };
      export async function run() {
        const launcher = document.getElementById('launcher'); launcher.focus();
        const root = createRoot(document.getElementById('root'));
        let closed = 0, backgroundEdits = 0;
        window.addEventListener('keydown', e => { if (hasOpenDialog()) return; if (e.key === 'Delete') backgroundEdits++; }, true);
        root.render(<Modal title="Settings" onClose={() => { closed++; root.render(null); }}><input id="first"/><button id="last">Last</button></Modal>);
        await tick();
        const dialog = document.querySelector('[role=dialog]');
        check(dialog.getAttribute('aria-modal') === 'true' && document.getElementById(dialog.getAttribute('aria-labelledby')).textContent === 'Settings', 'labelled dialog');
        check(dialog.contains(document.activeElement), 'initial focus');
        const key = (name, shiftKey=false) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:name,shiftKey,bubbles:true,cancelable:true}));
        document.getElementById('last').focus(); key('Tab');
        check(document.activeElement.getAttribute('aria-label') === 'Close dialog', 'Tab wraps');
        key('Tab',true); check(document.activeElement.id === 'last', 'Shift+Tab wraps');
        launcher.focus(); check(dialog.contains(document.activeElement), 'outside focus contained: active=' + document.activeElement.outerHTML + ' focused=' + document.hasFocus());
        key('Delete'); check(backgroundEdits === 0, 'background editing suppressed');
        document.getElementById('last').focus();
        const answer = confirmDialog('Nested confirmation'); await tick();
        check(document.querySelectorAll('[role=dialog]').length === 2 && document.activeElement.textContent === 'Cancel', 'nested dialog focus');
        key('Escape'); check(await answer === false, 'nested cancel'); await tick();
        check(closed === 0 && document.activeElement.id === 'last', 'only top dialog closes and focus restores');
        key('Escape'); await tick();
        check(closed === 1 && document.activeElement === launcher && !hasOpenDialog(), 'outer closes and restores launcher');
        // the setup wizard (list 36: it took the Welcome card's place) — its routes, and a refused key
        let route = '', saved = 0;
        setVidancerApi(new Proxy({getSettings:async()=>({falKey:'stored'}),setSettings:async()=>{saved++},arkValidate:async()=>({ok:false,error:'Invalid key'}),openExternal:async()=>{},bridgeList:async()=>[],onBridgeChanged:()=>()=>{}},{get:(t,k)=>k in t?t[k]:async()=>null}));
        root.render(<SetupWizard onClose={()=>{route='storyboard'}} onOpenSettings={()=>{route='settings'}} onOpenBridge={()=>{route='bridge'}} onOpenModels={()=>{route='local'}}/>);
        await tick();
        const button = label => [...document.querySelectorAll('.btn')].find(b=>b.textContent.trim()===label);
        button('start storyboarding').click(); check(route==='storyboard', 'storyboard route');
        button('all settings').click(); check(route==='settings', 'settings route');
        button('video').click(); await tick();
        const svc = id => document.querySelector('[data-service="'+id+'"]');
        [...svc('bridge-runway').querySelectorAll('.btn')].find(b=>b.textContent.trim()==='open the bridge panel').click(); check(route==='bridge', 'Bridge route');
        [...svc('local').querySelectorAll('.btn')].find(b=>b.textContent.trim()==='open the models card').click(); check(route==='local', 'local route');
        check(svc('fal').textContent.includes('key saved') && svc('ark').textContent.includes('not set'), 'a stored key shows as saved, a missing one as not set');
        const input=svc('ark').querySelector('input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'invalid-test-key');
        input.dispatchEvent(new Event('input',{bubbles:true})); await tick();
        [...svc('ark').querySelectorAll('button')].find(b=>b.textContent.trim()==='Check and save').click(); await tick(); await tick();
        check(saved===0 && svc('ark').textContent.includes('Invalid key') && svc('ark').textContent.includes('not set'), 'a refused key is never saved');
        root.unmount();
        return 'dialog semantics, focus containment/restoration, nested Escape, shortcut guard, setup routes and invalid credentials';
      }
    `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' },
    alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') },
    loader: { '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' }
  }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 30000, windowsHide: true })
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '')
  if (r.error) console.error(r.error.message)
  process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
      await win.loadURL('data:text/html,<button id="launcher">Launch</button><div id="root"></div>')
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      const result = await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()')
      console.log('PASS ' + result); app.exit(0)
    } catch (e) { console.error(e); app.exit(1) }
  })
}
