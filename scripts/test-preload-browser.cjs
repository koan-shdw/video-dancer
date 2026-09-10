// Smoke-check the built sandboxed preload in an isolated Electron profile.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-preload-test-'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 30000, windowsHide: true })
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '')
  if (r.error) console.error(r.error.message)
  process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    try {
      ipcMain.handle('recovery:status', () => ({dir:'fixture',count:1,checking:false,error:''}))
      const win = new BrowserWindow({ show:false, webPreferences:{ sandbox:true, contextIsolation:true, preload:path.resolve(__dirname,'../out/preload/index.js') } })
      await win.loadURL('data:text/html,<input type="file" id="file">')
      const file = path.join(process.argv[2], 'dropped.txt'); fs.writeFileSync(file, 'test')
      win.webContents.debugger.attach('1.3')
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument')
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId:root.nodeId, selector:'#file' })
      await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files:[file] })
      const result = await win.webContents.executeJavaScript(`(async()=>({
        path:window.vidancer.pathForFile(document.getElementById('file').files[0]),
        synthetic:window.vidancer.pathForFile(new File(['x'],'virtual.txt')),
        status:await window.vidancer.getRecoveryStatus(),
        isolated:typeof window.require === 'undefined'
      }))()`)
      require('node:assert/strict').deepEqual(result, {path:file,synthetic:'',status:{dir:'fixture',count:1,checking:false,error:''},isolated:true})
      console.log('PASS Electron '+process.versions.electron+' sandboxed preload, real File path, synthetic File and recovery IPC'); app.exit(0)
    } catch(e) { console.error(e); app.exit(1) }
  })
}
