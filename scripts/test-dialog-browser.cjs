// Real Chromium focus/portal checks, with mocked settings and no provider traffic.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-dialog-test-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({
    stdin: { contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {Modal} from '${ui}/ui/Modal'; import {hasOpenDialog} from '${ui}/ui/dialogFocus';
      import {confirmDialog} from '${ui}/prompt'; import {WelcomeModal} from '${ui}/panels/WelcomeModal';
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
        let route = '', saved = 0;
        setVidancerApi({getSettings:async()=>({falKey:'stored',arkKey:'stored'}),setSettings:async()=>{saved++},arkValidate:async()=>({ok:false,error:'Invalid key'}),openExternal:async()=>{}});
        root.render(<WelcomeModal onClose={()=>{route='storyboard'}} onOpenSettings={()=>{route='settings'}} onOpenBridge={()=>{route='bridge'}} onOpenModels={()=>{route='local'}}/>);
        await tick();
        const button = label => [...document.querySelectorAll('button')].find(b=>b.textContent===label);
        button('Start storyboarding').click(); check(route==='storyboard', 'storyboard route');
        button('Open Bridge logins').click(); check(route==='bridge', 'Bridge route');
        button('Open local model setup').click(); check(route==='local', 'local route');
        button('Connect an API key').click(); await tick();
        check(document.body.textContent.includes('Saved · not verified') && !document.body.textContent.includes('Connected'), 'stored keys are not verified');
        const input=document.getElementById('welcome-arkKey');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'invalid-test-key');
        input.dispatchEvent(new Event('input',{bubbles:true})); await tick();
        input.parentElement.querySelector('button').click(); await tick();
        check(saved===1 && document.body.textContent.includes('Invalid key') && !document.body.textContent.includes('Verified'), 'failed validation stays failed');
        root.unmount();
        return 'dialog semantics, focus containment/restoration, nested Escape, shortcut guard, setup routes and invalid credentials';
      }
    `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' },
    alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') },
    bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }
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
