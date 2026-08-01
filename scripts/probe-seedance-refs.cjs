// One-shot probe: does fal's Seedance 2.0 ref2v REALLY take video_urls, and is `seed` still a
// legal input? Runs headless in Electron so safeStorage (DPAPI) can decrypt the saved fal key.
// Cost: one 4s 480p render (~$0.54). Usage: npx electron scripts/probe-seedance-refs.cjs
const { app, safeStorage } = require('electron')
const { readFileSync, existsSync } = require('fs')
const { spawnSync } = require('child_process')
const { join } = require('path')

app.disableHardwareAcceleration()
// safeStorage's AES key lives in the app's userData ("Local State"). Cloning that one file into a
// scratch profile lets this probe decrypt WITHOUT touching the (possibly running) app's profile —
// DPAPI is user-scoped, so the key unwraps fine from any directory.
const { mkdirSync, copyFileSync } = require('fs')
const realUserData = join(process.env.APPDATA || '', 'vi-dancer')
const probeProfile = join(require('os').tmpdir(), 'vd-probe-profile')
mkdirSync(probeProfile, { recursive: true })
copyFileSync(join(realUserData, 'Local State'), join(probeProfile, 'Local State'))
app.setPath('userData', probeProfile)

function log(...a) { console.log('[probe]', ...a) }

async function main() {
  // ---- fal key from the app's settings (DPAPI-decrypted, never printed) ----
  const settingsPath = join(app.getPath('appData'), 'vi-dancer', 'settings.json')
  const s = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  if (!s.falKey || !String(s.falKey).startsWith('enc:')) throw new Error('no encrypted falKey in ' + settingsPath)
  const falKey = safeStorage.decryptString(Buffer.from(String(s.falKey).slice(4), 'base64'))
  log('fal key decrypted ok (length ' + falKey.length + ')')

  // ---- synthetic 3s test clip (test pattern + tone) — no user footage leaves the machine ----
  const ffmpeg = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked')
  const src = join(app.getPath('temp'), 'vd-probe-src.mp4')
  if (!existsSync(src)) {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', src])
    if (r.status !== 0) throw new Error('ffmpeg test clip failed: ' + r.stderr)
  }
  log('test clip ready:', src)

  const { fal } = require('@fal-ai/client')
  fal.config({ credentials: falKey })

  const buf = readFileSync(src)
  const file = new File([buf], 'probe.mp4', { type: 'video/mp4' })
  let videoUrl
  try {
    videoUrl = await fal.storage.upload(file)
  } catch (e) {
    log('storage.upload failed — status:', e && e.status, 'body:', e && e.body ? JSON.stringify(e.body).slice(0, 300) : '(none)')
    throw e
  }
  log('uploaded test clip')

  const endpoint = 'bytedance/seedance-2.0/reference-to-video'
  const base = {
    prompt: 'Continue from @video1. The same colorful test pattern keeps scrolling steadily. No new elements.',
    resolution: '480p',
    duration: '4',
    aspect_ratio: '16:9',
    generate_audio: false,
    video_urls: [videoUrl]
  }

  // ---- attempt 1: WITH seed (the schema question). A 422 here costs nothing. ----
  let usedSeed = true
  let result
  try {
    log('submitting WITH seed:42 …')
    result = await fal.subscribe(endpoint, { input: { ...base, seed: 42 }, logs: false,
      onQueueUpdate: (u) => u.status && log('fal:', u.status) })
  } catch (e) {
    const status = e && e.status
    const detail = e && e.body ? JSON.stringify(e.body).slice(0, 400) : String(e)
    log(`seed attempt failed (HTTP ${status}): ${detail}`)
    if (status !== 422) throw e // a non-schema failure — don't double-spend blindly
    usedSeed = false
    log('retrying WITHOUT seed …')
    result = await fal.subscribe(endpoint, { input: base, logs: false,
      onQueueUpdate: (u) => u.status && log('fal:', u.status) })
  }

  const out = (result && (result.data ?? result)) || {}
  log('RESULT keys:', Object.keys(out).join(', '))
  log('video url:', out.video && out.video.url ? 'YES (' + String(out.video.url).slice(0, 60) + '…)' : 'MISSING')
  log('returned seed:', out.seed)
  log('VERDICT: video_urls accepted =', !!(out.video && out.video.url), '· seed input accepted =', usedSeed)
}

app.whenReady().then(() =>
  main()
    .then(() => { log('done'); app.exit(0) })
    .catch((e) => { console.error('[probe] FAILED:', e && e.message ? e.message : e); app.exit(1) })
)
