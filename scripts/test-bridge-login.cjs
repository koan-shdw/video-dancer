// list 34 (2026-09-30) — Bridge logins for suppliers that register nobody on the spot. His try on
// Artlist was refused ("dynamic client registration is disabled"); ElevenLabs has no registration
// door at all. Both read a client page instead (Client ID Metadata Document, MCP authorization spec
// 2025-11-25): the client_id is the URL of this app's public page. The real login flow runs here;
// the supplier's servers and the browser are stand-ins, and nothing leaves this machine.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const realFetch = global.fetch
const opened = []
let browser = null // what "the user's browser" does with the login URL the app opens
const electron = { shell: { openExternal: async (u) => { opened.push(u); if (browser) void browser(new URL(u)) } }, app: { getPath: () => require('node:os').tmpdir() } }
const out = require('esbuild').buildSync({ stdin: { contents: `export { bridgeLogin, clientPage, CLIENT_PAGE_URL, CLIENT_PAGE_PORTS } from '${main}/bridge/oauth'; export { BRIDGE_SERVICES } from '${main}/bridge/services'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'], logLevel: 'silent' })
const mod = { exports: {} }
vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : require(n)), mod, mod.exports)
const m = mod.exports
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

;(async () => {
  const svc = Object.fromEntries(m.BRIDGE_SERVICES.map((s) => [s.id, s]))
  assert.equal(svc.artlist.blocked, undefined, 'Artlist: the login button is live')
  assert.equal(svc.elevenlabs.blocked, undefined, 'ElevenLabs: no longer shut, its login goes through the page')
  assert.equal(svc.artlist.mcpUrl, 'https://mcp.artlist.io/mcp')

  // ---- the page: what the app says it is, and the copy in the public repo says the same ----
  const page = m.clientPage()
  assert.equal(m.CLIENT_PAGE_URL, 'https://koan-shdw.github.io/video-dancer/oauth/client.json')
  assert.equal(page.client_id, m.CLIENT_PAGE_URL, 'the page names its own address as the client id')
  assert.equal(page.client_name, 'Video Dancer')
  assert.equal(page.token_endpoint_auth_method, 'none', 'a public client: no secret exists to leak')
  assert.deepEqual(page.redirect_uris, m.CLIENT_PAGE_PORTS.flatMap((p) => [`http://127.0.0.1:${p}/callback`, `http://localhost:${p}/callback`]), 'every redirect the app can listen on is listed')
  const clone = path.resolve(__dirname, '../oauth/client.json')
  if (fs.existsSync(clone)) assert.deepEqual(JSON.parse(fs.readFileSync(clone, 'utf8')), page, 'the file in the public repo is exactly what this build expects')

  // ---- stand-in servers ----
  const calls = []
  let world = {}
  global.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, method: init.method ?? 'GET', body: init.body, headers: init.headers ?? {} })
    if (u === m.CLIENT_PAGE_URL) return world.pageUp ? json(world.page ?? page) : new Response('Not Found', { status: 404 })
    if (u.includes('oauth-protected-resource')) return world.resource ? json(world.resource) : new Response('{}', { status: 404 })
    if (u.includes('oauth-authorization-server') || u.includes('openid-configuration')) return json(world.as)
    if (world.as.registration_endpoint && u === world.as.registration_endpoint) return world.register()
    if (u === world.as.token_endpoint) return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
    return new Response('{}', { status: 404 })
  }
  // the browser: signs "him" in and comes back to the app's loopback with the code
  const comeBack = (extra = '') => async (auth) => { await realFetch(`${auth.searchParams.get('redirect_uri')}?code=CODE&state=${auth.searchParams.get('state')}${extra}`) }
  const reset = (w) => { world = w; calls.length = 0; opened.length = 0 }
  const artlist = (over = {}) => ({
    resource: { resource: 'https://mcp.artlist.io/', authorization_servers: ['https://auth.artlist.io/'], scopes_supported: ['openid', 'offline_access'] },
    as: { issuer: 'https://auth.artlist.io/', authorization_endpoint: 'https://auth.artlist.io/authorize', token_endpoint: 'https://auth.artlist.io/oauth/token', registration_endpoint: 'https://auth.artlist.io/oidc/register', client_id_metadata_document_supported: true },
    register: () => json({ statusCode: 400, error: 'Bad Request', message: 'dynamic client registration is disabled' }, 400), // their reply to his try, word for word
    ...over
  })

  // ---- Artlist today: the door is shut, the page is not up yet. Said plainly, no browser opens ----
  reset(artlist({ pageUp: false }))
  browser = comeBack()
  await assert.rejects(m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist'), (e) => {
    assert.equal(e.message, 'Artlist’s login reads Video Dancer’s public page, and that page is not up yet (https://koan-shdw.github.io/video-dancer/oauth/client.json) — it goes live with the app’s next release')
    return true
  })
  assert.equal(opened.length, 0, 'no browser opens for a login that cannot work yet')
  const reg = calls.find((c) => c.url.endsWith('/oidc/register'))
  assert.deepEqual(Object.keys(JSON.parse(reg.body)).sort(), ['client_name', 'grant_types', 'redirect_uris', 'response_types', 'token_endpoint_auth_method'], 'the registration door is still tried first, as a public app on a loopback redirect')

  // ---- a page that names another id is as good as no page ----
  reset(artlist({ pageUp: true, page: { ...page, client_id: 'https://example.com/other.json' } }))
  await assert.rejects(m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist'), /that page is not up yet/)

  // ---- Artlist with the page up: in through the page ----
  reset(artlist({ pageUp: true }))
  const a = await m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist')
  const url = new URL(opened[0])
  assert.equal(url.origin + url.pathname, 'https://auth.artlist.io/authorize')
  assert.equal(url.searchParams.get('client_id'), m.CLIENT_PAGE_URL, 'the client id is the page')
  assert.ok(page.redirect_uris.includes(url.searchParams.get('redirect_uri')), 'the redirect is one the page lists: ' + url.searchParams.get('redirect_uri'))
  assert.equal(url.searchParams.get('resource'), 'https://mcp.artlist.io/', 'the token is asked for the name THEY give the MCP server')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('scope'), 'openid offline_access')
  const tok = calls.find((c) => c.url === 'https://auth.artlist.io/oauth/token')
  const form = new URLSearchParams(tok.body)
  assert.deepEqual([form.get('grant_type'), form.get('client_id'), form.get('code'), form.get('resource'), form.get('redirect_uri')], ['authorization_code', m.CLIENT_PAGE_URL, 'CODE', 'https://mcp.artlist.io/', url.searchParams.get('redirect_uri')])
  assert.ok(form.get('code_verifier') && !tok.headers.Authorization, 'a public client: the code verifier, no secret')
  assert.deepEqual([a.clientId, a.clientSecret, a.resource, a.accessToken, a.refreshToken, a.registrationEndpoint], [m.CLIENT_PAGE_URL, undefined, 'https://mcp.artlist.io/', 'AT', 'RT', 'https://auth.artlist.io/oidc/register'])

  // ---- ElevenLabs: no registration door at all, straight to the page; its regional host is the resource ----
  const eleven = (over = {}) => ({
    pageUp: true,
    resource: { resource: 'https://api.us.elevenlabs.io/v1/mcp', authorization_servers: ['https://api.us.elevenlabs.io'], scopes_supported: ['text_to_speech', 'voice_generation'] },
    as: { issuer: 'https://api.us.elevenlabs.io', authorization_endpoint: 'https://elevenlabs.io/app/oauth/authorize', token_endpoint: 'https://api.us.elevenlabs.io/v1/oauth/token', client_id_metadata_document_supported: true },
    ...over
  })
  reset(eleven())
  browser = comeBack('&iss=' + encodeURIComponent('https://api.us.elevenlabs.io'))
  const e = await m.bridgeLogin('https://api.elevenlabs.io/v1/mcp', 'ElevenLabs')
  assert.deepEqual([e.clientId, e.resource, e.accessToken], [m.CLIENT_PAGE_URL, 'https://api.us.elevenlabs.io/v1/mcp', 'AT'])
  assert.ok(!calls.some((c) => c.method === 'POST' && /register/.test(c.url)), 'nothing is registered where there is no door')
  // the login must come back from the server it went to (RFC 9207)
  reset(eleven())
  browser = comeBack('&iss=' + encodeURIComponent('https://evil.example'))
  await assert.rejects(m.bridgeLogin('https://api.elevenlabs.io/v1/mcp', 'ElevenLabs'), /came back from a different server/)
  assert.ok(!calls.some((c) => c.url.endsWith('/v1/oauth/token')), 'and its code is never exchanged')
  // a refusal on their login page comes back in their words
  reset(eleven())
  browser = async (auth) => { await realFetch(`${auth.searchParams.get('redirect_uri')}?error=access_denied&error_description=${encodeURIComponent('User denied access')}&state=${auth.searchParams.get('state')}`) }
  await assert.rejects(m.bridgeLogin('https://api.elevenlabs.io/v1/mcp', 'ElevenLabs'), /^Error: provider refused the login: access_denied \(User denied access\)$/)

  // Provider diagnostics are visible in the callback page and cannot become executable HTML.
  let callbackHtml = ''
  reset(eleven())
  browser = async (auth) => {
    const callback = new URL(auth.searchParams.get('redirect_uri'))
    callback.search = new URLSearchParams({ error: 'invalid_request', error_description: 'Unsupported prompt <script>alert(1)</script>', state: auth.searchParams.get('state') })
    callbackHtml = await realFetch(callback).then((r) => r.text())
  }
  await assert.rejects(m.bridgeLogin('https://api.elevenlabs.io/v1/mcp', 'ElevenLabs'), /Unsupported prompt/)
  for (let i = 0; i < 100 && !callbackHtml; i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(callbackHtml.includes('Unsupported prompt &lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(!callbackHtml.includes('<script>'))

  // ---- a supplier whose registration door works keeps using it, page or no page (the proven path) ----
  reset(artlist({ pageUp: true, register: () => json({ client_id: 'dyn-123' }, 201) }))
  browser = comeBack()
  const d = await m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist')
  assert.equal(d.clientId, 'dyn-123')
  assert.equal(new URL(opened[0]).searchParams.get('client_id'), 'dyn-123')
  assert.ok(!calls.some((c) => c.url === m.CLIENT_PAGE_URL), 'the page is not even read')

  // ---- no page support: a shut door says why in the supplier's own words, and no browser opens ----
  const noPage = (register) => artlist({ as: { ...artlist().as, client_id_metadata_document_supported: false }, register })
  reset(noPage(() => json({ statusCode: 400, error: 'Bad Request', message: 'dynamic client registration is disabled' }, 400)))
  await assert.rejects(m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist'), (err) => {
    assert.equal(err.message, 'Artlist refused desktop client registration (400: dynamic client registration is disabled) — their MCP may only allow known web clients today', 'the reason he could not see on 09-30 now rides the row')
    return true
  })
  reset(noPage(() => json({ error: 'invalid_redirect_uri', error_description: 'Loopback redirect URIs are not allowed for this tenant' }, 400)))
  await assert.rejects(m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist'), /\(400: Loopback redirect URIs are not allowed for this tenant\)/)
  reset(noPage(() => new Response('nope', { status: 403 })))
  await assert.rejects(m.bridgeLogin('https://mcp.artlist.io/mcp', 'Artlist'), /^Error: Artlist refused desktop client registration \(403\) — /)
  assert.equal(opened.length, 0, 'a refused registration never opens the browser')
  // neither a door nor page support
  reset(eleven({ as: { ...eleven().as, client_id_metadata_document_supported: false } }))
  await assert.rejects(m.bridgeLogin('https://api.elevenlabs.io/v1/mcp', 'ElevenLabs'), /^Error: ElevenLabs publishes no registration endpoint/)

  console.log('PASS Bridge logins: a shut registration door says why in the supplier’s words (Artlist’s own reply); where the login server reads client pages the app goes in through its public page (fixed loopback ports, no secret, the supplier’s own resource name), says plainly when the page is not up, and keeps a working registration door; the public repo’s page file matches the build; a login that comes back from another server is refused')
})().catch((e) => { console.error(e); process.exitCode = 1 })
