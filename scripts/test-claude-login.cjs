// list 38 (2026-09-30) — log in to Claude from the app. When the Claude Code login has run out,
// one button runs Claude Code's own `auth login` (his browser, Anthropic's page, no terminal),
// waits for it, and sends the failed message again. Part 1: the core, against a fake Claude Code.
// Part 2: the renderer's store, in offscreen Electron. Nothing here signs in to anything.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-claude-login-'))
  const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const raw = {
    name: 'raw',
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
      b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
    }
  }
  const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
  const FAKE_EXE = path.join(tmp, 'claude.exe')
  fs.writeFileSync(FAKE_EXE, '')
  // the fake Claude Code: logged out until its `auth login` ends the way `behave` says
  let loggedIn = false, behave = 'ok'
  const spawned = [], authEnvs = []
  let live = null
  const childProcess = {
    ...require('node:child_process'),
    execFile: (file, args, _o, cb) => setImmediate(() => {
      if (args[0] === 'auth') authEnvs.push(_o.env)
      if (args.join(' ') === 'auth logout') loggedIn = false
      cb(null, /where|which/.test(file) ? FAKE_EXE : args[0] === '--version' ? '2.1.300 (Claude Code)' : args[0] === 'auth' ? JSON.stringify({ loggedIn, authMethod: 'claude.ai' }) : '', '')
    }),
    spawn: (file, args, opts) => {
      if (file === 'taskkill' || file === 'kill') { live?.emit('close', null); return new EventEmitter() }
      const child = new EventEmitter()
      child.pid = 4242
      child.kill = () => child.emit('close', null)
      child.stdin = { on() {}, write() {}, end() {} }
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      spawned.push({ file, args, env: opts?.env })
      live = child
      if (behave === 'ok') setTimeout(() => { loggedIn = true; child.stdout.write('Login successful.\n'); child.emit('close', 0) }, 40)
      if (behave === 'refused') setTimeout(() => { child.stderr.write('Error: login needs an interactive terminal\n'); setImmediate(() => child.emit('close', 1)) }, 20)
      // 'hang': he never finishes in the browser
      return child
    }
  }
  const fakeFs = { ...require('node:fs'), existsSync: (p) => (/claude(\.exe)?$/i.test(String(p)) || /cli\.js$/.test(String(p)) ? String(p) === FAKE_EXE : fs.existsSync(p)) }

  ;(async () => {
    const out = await require('esbuild').build({ stdin: { contents: `export { loginClaudeCli, logoutClaudeCli, cancelClaudeLogin, detectClaudeCli, LOGIN_EXPIRED } from '${main}/codirBridge'; export { CLAUDE_LOGIN_EXPIRED } from '${ui}/shared/models'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
    const mod = { exports: {} }
    vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : n === 'child_process' ? childProcess : n === 'fs' ? fakeFs : require(n)), mod, mod.exports)
    const m = mod.exports
    assert.equal(m.LOGIN_EXPIRED, m.CLAUDE_LOGIN_EXPIRED, 'one line for both sides')
    process.env.ANTHROPIC_API_KEY = 'must-not-ride'

    // he signs in: Claude Code's own command, and its own status is the proof
    assert.equal((await m.detectClaudeCli(true)).loggedIn, false)
    let r = await m.loginClaudeCli()
    assert.deepEqual([r.ok, r.loggedIn, r.out], [true, true, ''])
    assert.deepEqual([spawned.at(-1).file, spawned.at(-1).args], [FAKE_EXE, ['auth', 'login']], 'nothing but Claude Code’s own sign-in runs')
    assert.ok(!('ANTHROPIC_API_KEY' in spawned.at(-1).env), 'an API key in the environment never rides along')
    assert.equal(spawned.at(-1).env.CLAUDE_CONFIG_DIR, path.join(tmp, 'llm-accounts', 'claude'))
    // already in: nothing runs
    const n = spawned.length
    r = await m.loginClaudeCli()
    assert.deepEqual([r.ok, spawned.length], [true, n])
    assert.equal((await m.logoutClaudeCli()).ok, true)
    assert.ok(authEnvs.every(env => env.CLAUDE_CONFIG_DIR === path.join(tmp, 'llm-accounts', 'claude')), 'login checks and native logout use the same isolated profile')
    // Claude Code can't do it from here: its own words come back
    loggedIn = false; behave = 'refused'
    r = await m.loginClaudeCli()
    assert.deepEqual([r.ok, r.loggedIn, r.out], [false, false, 'Error: login needs an interactive terminal'])
    // he walks away from the browser: it ends by itself, and says so
    behave = 'hang'
    r = await m.loginClaudeCli(150)
    assert.equal(r.ok, false)
    assert.match(r.out, /^the sign-in was not finished within \d+ minutes$/)
    // the stop button ends a sign-in in flight
    const waiting = m.loginClaudeCli(60_000)
    await new Promise((res) => setTimeout(res, 60))
    m.cancelClaudeLogin()
    assert.equal((await waiting).ok, false)
    const one = m.loginClaudeCli(60_000), two = m.loginClaudeCli(60_000)
    assert.equal(one, two, 'duplicate clicks share one native login')
    assert.equal((await m.logoutClaudeCli()).ok, true, 'logout cancels and awaits any pending login')
    assert.equal((await one).ok, false)
    console.log('PASS Claude sign-in, the core: runs only `claude auth login`, no API key in its environment, proven by Claude Code’s own status; a refusal, a walk-away and the stop button all end cleanly')

    // ---- part 2: the store, in offscreen Electron ----
    const code = require('esbuild').buildSync({ stdin: { contents: `
      import {useStore} from '${ui}/store';
      import {setVidancerApi} from '${ui}/api';
      import {CLAUDE_LOGIN_EXPIRED} from '${ui}/shared/models';
      const check=(ok,msg)=>{if(!ok)throw Error(msg)};
      const tick=(ms=30)=>new Promise(r=>setTimeout(r,ms));
      export async function run(){
        const sends=[];let answer={ok:false,error:CLAUDE_LOGIN_EXPIRED};let login={found:true,ok:false,out:'Error: login needs an interactive terminal',detail:'x'};let logins=0;
        setVidancerApi(new Proxy({codirSend:async a=>{sends.push(a.text);return answer},codirBridgeLogin:async()=>{logins++;return login}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
        useStore.setState({project:{dir:'synthetic',images:[]},refreshSpend:async()=>{},codirQueue:[]});
        await useStore.getState().codirSendText('tighten the beats');await tick();
        check(useStore.getState().codirLoginExpired?.text==='tighten the beats','an expired login keeps the message: '+JSON.stringify(useStore.getState().codirLoginExpired));
        check(!useStore.getState().codirRun.busy,'and frees the panel');
        await useStore.getState().signInClaude();await tick();
        check(logins===1&&sends.length===1&&useStore.getState().codirLoginExpired,'a sign-in that did not finish sends nothing and keeps the offer');
        login={found:true,ok:true,out:'',detail:'x',loggedIn:true};answer={ok:true,reply:'done'};
        await useStore.getState().signInClaude();await tick(80);
        check(logins===2&&sends.length===2&&sends[1]==='tighten the beats','signed in: the same message goes again: '+JSON.stringify(sends));
        check(useStore.getState().codirLoginExpired===null,'and the offer clears');
        answer={ok:false,error:'API error 500'};await useStore.getState().codirSendText('again');await tick();
        check(useStore.getState().codirLoginExpired===null,'any other failure is not a login offer');
        return 'Claude sign-in, the panel: an expired login keeps the message, the button signs in and sends it again; a sign-in that did not finish keeps the offer';
      }
    `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
    fs.writeFileSync(path.join(tmp, 'checks.js'), code)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const e = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
    process.stdout.write((e.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l)).join('\n') + '\n'); if (e.status !== 0) process.stderr.write((e.stderr || '').slice(-2000)); process.exitCode = e.status === 0 ? 0 : 1
  })().catch((e) => { console.error(e); process.exitCode = 1 })
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadURL('data:text/html,<div id="root"></div>')
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
