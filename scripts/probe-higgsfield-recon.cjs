// No-spend Higgsfield recon: reads the ALREADY-STORED encrypted hfKey from the app's settings
// (never prints it), then POSTs deliberately EMPTY bodies at candidate application ids.
// 404 = id doesn't exist on the platform API · 4xx schema feedback = it EXISTS (and we stopped
// before paying). Usage: npx electron scripts/probe-higgsfield-recon.cjs
const { app, safeStorage } = require('electron')
const { readFileSync, mkdirSync, copyFileSync } = require('fs')
const { join } = require('path')

app.disableHardwareAcceleration()
// same trick as probe-higgsfield.cjs: clone Local State into a scratch profile so safeStorage
// decrypts with the SAME key the app encrypted with (DPAPI is user-scoped, so this works)
const realUserData = join(process.env.APPDATA || '', 'vi-dancer')
const probeProfile = join(require('os').tmpdir(), 'vd-probe-profile')
mkdirSync(probeProfile, { recursive: true })
copyFileSync(join(realUserData, 'Local State'), join(probeProfile, 'Local State'))
app.setPath('userData', probeProfile)

const BASE = 'https://platform.higgsfield.ai'
function log(...a) { console.log('[hf-recon]', ...a) }

async function main() {
  const s = JSON.parse(readFileSync(join(realUserData, 'settings.json'), 'utf-8'))
  if (!s.hfKey || !String(s.hfKey).startsWith('enc:')) throw new Error('no stored hfKey')
  const combined = safeStorage.decryptString(Buffer.from(String(s.hfKey).slice(4), 'base64'))
  const headers = { Authorization: `Key ${combined}`, 'Content-Type': 'application/json' }

  const authRes = await fetch(`${BASE}/requests/00000000-0000-0000-0000-000000000000/status`, { headers })
  log(`auth probe: HTTP ${authRes.status} ${authRes.status === 401 || authRes.status === 403 ? '— KEY REJECTED' : '— auth OK'}`)
  if (authRes.status === 401 || authRes.status === 403) return

  const candidates = [
    'seedance_2_0', 'seedance_2_0_mini', 'seedance_2_5', 'seedance_2_5_pro',
    'seedance1_5', 'higgsfield-ai/seedance_2_0', 'bytedance/seedance-2.0', 'seedance-2-0'
  ]
  for (const id of candidates) {
    const r = await fetch(`${BASE}/${id}`, { method: 'POST', headers, body: '{}' })
    const text = await r.text().catch(() => '')
    log(`POST /${id} (empty body): HTTP ${r.status}${r.status === 404 ? ' — NOT on the platform API' : ` — EXISTS?: ${text.slice(0, 200)}`}`)
    await new Promise((res) => setTimeout(res, 400))
  }
  log('done — 404 everywhere = platform API still serves no Seedance')
}

app.whenReady().then(() =>
  main()
    .then(() => app.exit(0))
    .catch((e) => { console.error('[hf-recon] FAILED:', e && e.message ? e.message : e); app.exit(1) })
)
