// Exercise actual paused decoding/seek callbacks in the app's Electron runtime.
// Synthetic media and a separate temporary profile; no visible windows or user data.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const { buildSync } = require('esbuild')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-monitor-test-'))
  for (const color of ['red', 'green', 'blue']) {
    const r = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=${process.env.VD_TEST_FPS || '24'}:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(tmp, color + '.mp4')])
    if (r.status !== 0) throw new Error(String(r.stderr))
  }
  const combined = spawnSync(require('ffmpeg-static'), ['-v', 'error', ...['red', 'green', 'blue'].flatMap(color => ['-i', path.join(tmp, color + '.mp4')]), '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(tmp, 'timeline.mp4')])
  if (combined.status !== 0) throw new Error(String(combined.stderr))
  const code = buildSync({ entryPoints: [path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/lib/prepareVideoFrame.ts')], bundle: true, format: 'iife', globalName: 'binding', write: false }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'helper.js'), code)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (r.error) console.error(r.error.message)
  process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron')
  const tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadURL('data:text/html,<video id="v" muted preload="auto"></video><canvas id="c" width="64" height="64"></canvas>')
    const helper = fs.readFileSync(path.join(tmp, 'helper.js'), 'utf8')
    const sources = Object.fromEntries(['red', 'green', 'blue', 'timeline'].map((color) => [color, 'data:video/mp4;base64,' + fs.readFileSync(path.join(tmp, color + '.mp4')).toString('base64')]))
    try {
      const result = await win.webContents.executeJavaScript(`${helper}\n(async () => {
        const sources = ${JSON.stringify(sources)};
        const v = document.getElementById('v');
        const ctx = document.getElementById('c').getContext('2d');
        let cancel = () => {};
        let previous = null;
        let count = 0;
        const bind = (color, target, expectedColor = color) => new Promise((resolve, reject) => {
          cancel();
          const timer = setTimeout(() => reject(new Error('decode gate timed out: ' + color + ' @ ' + target + ' ready=' + v.readyState + ' seek=' + v.seeking)), 3000);
          cancel = binding.prepareVideoFrame(v, { url: sources[color], target, sourceChanged: previous !== color, gate: true, onReady: () => {
            clearTimeout(timer);
            ctx.drawImage(v, 0, 0, 64, 64);
            const pixel = ctx.getImageData(32, 32, 1, 1).data;
            const expected = {red: 0, green: 1, blue: 2}[expectedColor];
            if (pixel[expected] < 80 || pixel[expected] < Math.max(...[0,1,2].filter(i => i !== expected).map(i => pixel[i])) * 2) reject(new Error('wrong frame: expected ' + color + ', got ' + [...pixel]));
            else { count++; resolve(); }
          }});
          previous = color;
        });
        for (let i = 0; i < 8; i++) {
          await bind('red', 0.2);
          await bind('green', 0.4);
          await bind('blue', 0.6);
          await bind('blue', 0.1);
          await bind('timeline', 0.2, 'red');
          await bind('timeline', 1.4, 'green');
          await bind('timeline', 2.6, 'blue');
          await bind('timeline', 0.1, 'red');
        }
        cancel();
        return { decodedFramesChecked: count };
      })()`)
      console.log('PASS Electron decoded-frame checks: ' + JSON.stringify(result))
      app.exit(0)
    } catch (e) {
      console.error(String(e))
      app.exit(1)
    }
  }).catch((e) => { console.error(e); app.exit(1) })
}
