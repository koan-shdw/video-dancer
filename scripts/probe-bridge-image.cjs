// Bridge image probe (list 9, his ok 09-30: "3. yes" to asking the bridges what image tools they
// have and one test picture each). Reads the app's ALREADY-STORED bridge logins (never prints a
// token), and never refreshes one: a refresh would rotate the login out from under the app. A
// login whose stored token has run out is skipped and named, so he can open the Bridge panel
// (the app refreshes it) and this can be run again. Everything goes through the app's own code.
//
//   npx electron scripts/probe-bridge-image.cjs
//        who is logged in, and how long each stored token still lasts
//   npx electron scripts/probe-bridge-image.cjs call <service> <tool> <args.json | ->
//        one tool call (the app's MCP client). Free reads: model lists, balances, cost checks
//   npx electron scripts/probe-bridge-image.cjs render <service> <slug> <size> <base image | -> "<prompt>" [ratio]
//        ONE picture through the app's real Image Edit lane (src/main/providers/mcp/bridgeImage.ts).
//        SPENDS that plan's credits. The file lands in scripts/probe-out/.
//
// Same profile trick as probe-higgsfield.cjs: Local State is cloned into a scratch profile so
// safeStorage decrypts with the key the app encrypted with (DPAPI is user-scoped).
const { app, safeStorage } = require('electron')
const { readFileSync, mkdirSync, copyFileSync, writeFileSync } = require('fs')
const { join, resolve } = require('path')
const vm = require('node:vm')

app.disableHardwareAcceleration()
// the app's data folder: VIDEO_DANCER_DATA_DIR when the launcher sets it (his I:/APPS/Video Dancer/Data since 2026-10-10), else Electron's default
const realUserData = process.env.VIDEO_DANCER_DATA_DIR ? resolve(process.env.VIDEO_DANCER_DATA_DIR) : join(process.env.APPDATA || '', 'vi-dancer')
const probeProfile = join(require('os').tmpdir(), 'vd-probe-profile')
mkdirSync(probeProfile, { recursive: true })
copyFileSync(join(realUserData, 'Local State'), join(probeProfile, 'Local State'))
app.setPath('userData', probeProfile)

const log = (...a) => console.log('[bridge-probe]', ...a)
const OUT = join(__dirname, 'probe-out')

async function appCode(entry) {
  const main = resolve(__dirname, '../src/main').replaceAll('\\', '/')
  const raw = {
    name: 'raw',
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
      b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }))
    }
  }
  const out = await require('esbuild').build({ stdin: { contents: entry.replaceAll('@main', main), resolveDir: resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', '@fal-ai/client', 'ffmpeg-static'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')(require, mod, mod.exports)
  return mod.exports
}

function storedLogins() {
  const s = JSON.parse(readFileSync(join(realUserData, 'settings.json'), 'utf-8'))
  if (!s.bridgeAuth || !String(s.bridgeAuth).startsWith('enc:')) return {}
  return JSON.parse(safeStorage.decryptString(Buffer.from(String(s.bridgeAuth).slice(4), 'base64')))
}
function live(logins, service) {
  const a = logins[service]
  if (!a) throw new Error(`no stored login for ${service}`)
  if (a.expiresAt && a.expiresAt < Date.now() + 90_000) throw new Error(`${service}: the stored token has run out — open the Bridge panel in the app (it refreshes the login), then run this again`)
  return a
}

async function main() {
  const logins = storedLogins()
  const [mode, service, ...rest] = process.argv.slice(2)
  mkdirSync(OUT, { recursive: true })

  if (mode === 'call') {
    const [tool, argFile] = rest
    const a = live(logins, service)
    const { McpClient, BRIDGE_SERVICES } = await appCode(`export { McpClient } from '@main/bridge/mcpClient'; export { BRIDGE_SERVICES } from '@main/bridge/services'`)
    const client = new McpClient(BRIDGE_SERVICES.find((x) => x.id === service).mcpUrl, () => a.accessToken)
    const res = await client.callTool(tool, argFile && argFile !== '-' ? JSON.parse(readFileSync(argFile, 'utf-8')) : {})
    const out = join(OUT, `bridge-${service}-${tool}.json`)
    writeFileSync(out, JSON.stringify(res, null, 2))
    const text = [JSON.stringify(res.structuredContent ?? ''), ...(res.content ?? []).map((c) => c.text ?? `[${c.type}]`)].join('\n')
    log(`${service}.${tool} → ${res.isError ? 'ERROR ' : ''}${text.length} chars, saved to ${out}`)
    console.log(text.slice(0, 8000))
    return
  }

  if (mode === 'render') {
    const [slug, size, base, prompt, ratio] = rest
    live(logins, service)
    // the app's own bridge manager and image lane, on the stored login with its refresh token taken
    // out: whatever happens here, the app's login cannot be rotated away
    const safe = Object.fromEntries(Object.entries(logins).filter(([id]) => id === service).map(([id, a]) => [id, { ...a, refreshToken: undefined }]))
    const m = await appCode(`export { initBridge } from '@main/bridge'; export { runBridgeImage } from '@main/providers/mcp/bridgeImage'`)
    await m.initBridge({ load: async () => JSON.stringify(safe), save: async () => {} }, () => {})
    const t0 = Date.now()
    const r = await m.runBridgeImage({ service, slug, label: slug, prompt, baseImage: base && base !== '-' ? resolve(base) : undefined, refImages: [], numImages: 1, aspectRatio: ratio || (base && base !== '-' ? 'auto' : '1:1'), resolution: size === '-' ? undefined : size, outDir: OUT, onProgress: (msg) => log('·', msg) })
    log(`RENDERED on ${service}/${slug} in ${Math.round((Date.now() - t0) / 1000)} s → ${r.files.join(', ')}`)
    return
  }

  for (const [id, a] of Object.entries(logins)) {
    const left = a.expiresAt ? Math.round((a.expiresAt - Date.now()) / 60000) : null
    log(`${id}: logged in · access token ${left == null ? 'has no stated end' : left > 0 ? `good for ${left} more min` : `ran out ${-left} min ago`} · refresh token ${a.refreshToken ? 'kept' : 'none'}`)
  }
  if (!Object.keys(logins).length) log('no bridge logins stored')
}

app.whenReady().then(() =>
  main()
    .then(() => app.exit(0))
    .catch((e) => { console.error('[bridge-probe] FAILED:', e && e.message ? e.message : e); app.exit(1) })
)
