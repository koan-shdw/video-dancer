// Exercise the real renderer store with deferred replies; no provider traffic.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-queue-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import {useStore} from '${ui}/store';
    import {setVidancerApi} from '${ui}/api';
    const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const tick=()=>new Promise(r=>setTimeout(r,0));
    export async function run(){
      const calls=[], replies=[];
      setVidancerApi({codirSend:args=>{calls.push(args);return new Promise(resolve=>replies.push(resolve))}});
      useStore.setState({project:{dir:'synthetic',images:[{id:'a',title:'@first'},{id:'b',title:'@second'}]},refreshSpend:async()=>{},codirQueue:[]});
      const send=text=>useStore.getState().codirSendText(text);
      const first=send('current request');
      await send('first queued @first');await send('remove this');await send('second queued @second');
      const removed=useStore.getState().codirQueue[1].id;
      useStore.getState().codirQueueRemove(removed);
      await send('   ');
      check(calls.length===1,'queued messages must wait for the current reply');
      replies[0]({ok:true});await first;
      check(calls.length===2,'all waiting messages must start in one follow-up');
      check(calls[1].text==='first queued @first\\n\\nsecond queued @second','order, boundaries and removed messages');
      check(JSON.stringify(calls[1].imageIds)==='["a","b"]','references from every queued message');
      check(useStore.getState().codirRun.pendingUser===calls[1].text,'combined request appears in the transcript');
      check(useStore.getState().codirQueue.length===0&&useStore.getState().codirRun.busy,'batch is drained once and remains busy');
      await send('arrives during batch');await send('also during batch');
      check(calls.length===2,'new arrivals wait for their own batch');
      replies[1]({ok:true});await tick();
      check(calls.length===3&&calls[2].text==='arrives during batch\\n\\nalso during batch','new arrivals form the next complete batch');
      replies[2]({ok:true});await tick();
      check(!useStore.getState().codirRun.busy&&calls.length===3,'no duplicate requests after drain');
      const single=send('another current request');await send('only queued message');
      replies[3]({ok:true});await single;
      check(calls[4].text==='only queued message','one waiting message keeps its original text');
      replies[4]({ok:true});await tick();
      return 'whole-queue follow-up, order, removal, references, new arrivals, single messages and no duplicates';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 30000, windowsHide: true })
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); if (r.error) console.error(r.error)
  process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadURL('data:text/html,<div id="root"></div>')
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.error(e); app.exit(1) } })
}
