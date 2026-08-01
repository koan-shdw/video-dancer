// One-shot Higgsfield probe: store the key (encrypted) in the app's settings, verify auth free,
// then run ONE cheap seedance_2_0 render to confirm the application id + argument field names.
// Usage: HF_COMBINED="api-key:api-secret" npx electron scripts/probe-higgsfield.cjs
// The key rides in via env only — it never lands in a file as plaintext.
const { app, safeStorage } = require('electron')
const { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } = require('fs')
const { join } = require('path')

app.disableHardwareAcceleration()
// safeStorage's AES key lives in the app's userData ("Local State") — clone that one file into a
// scratch profile so we encrypt with the SAME key the app decrypts with (DPAPI is user-scoped).
const realUserData = join(process.env.APPDATA || '', 'vi-dancer')
const probeProfile = join(require('os').tmpdir(), 'vd-probe-profile')
mkdirSync(probeProfile, { recursive: true })
copyFileSync(join(realUserData, 'Local State'), join(probeProfile, 'Local State'))
app.setPath('userData', probeProfile)

const BASE = 'https://platform.higgsfield.ai'
function log(...a) { console.log('[hf-probe]', ...a) }

async function main() {
  const combined = process.env.HF_COMBINED
  if (!combined || !combined.includes(':')) throw new Error('set HF_COMBINED="api-key:api-secret"')
  const headers = { Authorization: `Key ${combined}`, 'Content-Type': 'application/json' }

  // ---- 1. store encrypted hfKey in the app's settings.json (atomic) ----
  const settingsPath = join(realUserData, 'settings.json')
  const s = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  s.hfKey = 'enc:' + safeStorage.encryptString(combined).toString('base64')
  const tmp = settingsPath + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8')
  renameSync(tmp, settingsPath)
  log('hfKey stored encrypted in settings.json ✓ (restart the app to pick it up)')

  // ---- 2. free auth probe (no credits) ----
  const authRes = await fetch(`${BASE}/requests/00000000-0000-0000-0000-000000000000/status`, { headers })
  log(`auth probe: HTTP ${authRes.status} ${authRes.status === 401 || authRes.status === 403 ? '— KEY REJECTED' : '— auth OK (404/4xx-not-auth is fine here)'}`)
  if (authRes.status === 401 || authRes.status === 403) {
    const body = await authRes.text().catch(() => '')
    throw new Error(`key rejected: ${body.slice(0, 300)}`)
  }

  // ---- 3. one cheap render — try candidate application ids until one accepts (404s cost nothing) ----
  const candidates = ['seedance_2_0', 'higgsfield-ai/seedance_2_0', 'bytedance/seedance-2.0', 'seedance-2-0']
  const args = {
    prompt: 'A colorful abstract test pattern slowly rotating. Simple, steady motion.',
    aspect_ratio: '16:9',
    duration: 4,
    resolution: '480p',
    generate_audio: false
  }
  let requestId = null
  let usedApp = null
  for (const appId of candidates) {
    const r = await fetch(`${BASE}/${appId}`, { method: 'POST', headers, body: JSON.stringify(args) })
    const text = await r.text().catch(() => '')
    log(`submit ${appId}: HTTP ${r.status}${r.ok ? '' : ` — ${text.slice(0, 220)}`}`)
    if (r.ok) {
      const j = JSON.parse(text)
      requestId = j.request_id
      usedApp = appId
      log('accepted ✓ request_id:', requestId)
      break
    }
    if (r.status !== 404) {
      // not a wrong-id problem — a schema error tells us the FIELD NAMES need fixing; stop and report
      log('non-404 rejection — argument schema feedback above is the finding. Stopping.')
      return
    }
  }
  if (!requestId) {
    log('VERDICT: no candidate application id was accepted — the model id needs different recon.')
    return
  }

  // ---- poll to completion ----
  let last = ''
  for (let i = 0; i < 300; i++) {
    await new Promise((res) => setTimeout(res, 2000))
    const r = await fetch(`${BASE}/requests/${requestId}/status`, { headers })
    if (!r.ok) { log(`status HTTP ${r.status}`); continue }
    const body = await r.json()
    const st = String(body.status ?? '').toLowerCase()
    if (st !== last) { last = st; log('status:', st) }
    if (st === 'completed') {
      const v = body.video ?? body.result?.video ?? (Array.isArray(body.videos) ? body.videos[0] : undefined)
      const url = typeof v === 'string' ? v : v?.url ?? body.video_url ?? body.url
      log('RESULT keys:', Object.keys(body).join(', '))
      log('video url:', url ? 'YES (' + String(url).slice(0, 70) + '…)' : 'MISSING — raw: ' + JSON.stringify(body).slice(0, 400))
      log(`VERDICT: application id "${usedApp}" works · args accepted · result shape ${url ? 'matches the adapter' : 'NEEDS ADAPTER FIX (see raw above)'}`)
      return
    }
    if (st === 'failed' || st === 'nsfw' || st === 'cancelled') {
      log('terminal without success:', st, JSON.stringify(body).slice(0, 300))
      return
    }
  }
  log('timed out after ~10min — check the request in the Higgsfield dashboard')
}

app.whenReady().then(() =>
  main()
    .then(() => { log('done'); app.exit(0) })
    .catch((e) => { console.error('[hf-probe] FAILED:', e && e.message ? e.message : e); app.exit(1) })
)
