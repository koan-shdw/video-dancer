// list 34 (2026-09-30) — Artlist's Bridge login is open to a try again; ElevenLabs stays shut with
// the real reason. A supplier that refuses the app's registration says why on the row, in its own
// words, and no browser opens. The real login flow; the supplier's servers are fakes.
const path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const opened = []
const electron = { shell: { openExternal: async (u) => { opened.push(u) } }, app: { getPath: () => require('node:os').tmpdir() } }
const out = require('esbuild').buildSync({ stdin: { contents: `export { bridgeLogin } from '${main}/bridge/oauth'; export { BRIDGE_SERVICES } from '${main}/bridge/services'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'], logLevel: 'silent' })
const mod = { exports: {} }
vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : require(n)), mod, mod.exports)
const m = mod.exports

;(async () => {
  const svc = Object.fromEntries(m.BRIDGE_SERVICES.map((s) => [s.id, s]))
  assert.equal(svc.artlist.blocked, undefined, 'Artlist: the login button tries again')
  assert.equal(svc.artlist.mcpUrl, 'https://mcp.artlist.io/mcp')
  assert.equal(svc.elevenlabs.blocked, 'ElevenLabs needs a public page for this app first', 'ElevenLabs: shut, with the reason that is true today')

  const calls = []
  let register = () => new Response(JSON.stringify({ error: 'invalid_redirect_uri', error_description: 'Loopback redirect URIs are not allowed for this tenant' }), { status: 400 })
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body })
    const u = String(url)
    if (u.includes('oauth-protected-resource')) return new Response(JSON.stringify({ resource: 'https://mcp.artlist.io/', authorization_servers: ['https://auth.artlist.io/'], scopes_supported: ['openid', 'offline_access'] }))
    if (u.includes('oauth-authorization-server') || u.includes('openid-configuration')) return new Response(JSON.stringify({ authorization_endpoint: 'https://auth.artlist.io/authorize', token_endpoint: 'https://auth.artlist.io/oauth/token', registration_endpoint: 'https://auth.artlist.io/oidc/register' }))
    if (u === 'https://auth.artlist.io/oidc/register') return register()
    return new Response('{}', { status: 404 })
  }
  await assert.rejects(m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist'), (e) => {
    assert.equal(e.message, 'Artlist refused desktop client registration (400: Loopback redirect URIs are not allowed for this tenant) — their MCP may only allow known web clients today')
    return true
  })
  const reg = calls.find((c) => c.url.endsWith('/oidc/register'))
  assert.deepEqual(Object.keys(JSON.parse(reg.body)).sort(), ['client_name', 'grant_types', 'redirect_uris', 'response_types', 'token_endpoint_auth_method'], 'it registers as a public app on a loopback redirect, as before')
  assert.match(JSON.parse(reg.body).redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.equal(opened.length, 0, 'a refused registration never opens the browser')
  // a refusal with no body still reads plainly
  register = () => new Response('nope', { status: 403 })
  await assert.rejects(m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist'), /^Error: Artlist refused desktop client registration \(403\) — /)

  console.log('PASS Bridge logins: Artlist open to a try, ElevenLabs shut with today’s reason; a refused registration says why in the supplier’s words and opens no browser')
})().catch((e) => { console.error(e); process.exitCode = 1 })
