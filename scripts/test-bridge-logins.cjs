// list 33 (2026-09-30) — SEVERAL LOGINS PER BRIDGE. "several of same bridge, ability ot hit a plus
// and add a new one for each bridge", all "in the credit pool". His answers: the login with the
// most credits left pays; rows named "Higgsfield 1, 2, 3" that he can rename; the ＋ says what their
// login page does. The real bridge manager and the real login flow run here; the supplier's
// servers and the browser are stand-ins, and nothing leaves this machine.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bridge-logins-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const realFetch = global.fetch
const opened = [], clip = []
let who = 'A' // the account "his browser" is signed in to on the supplier's site
const authorization = (u) => {
  const logout = new URL(u)
  assert.equal(logout.origin + logout.pathname, 'https://higgsfield.ai/auth/logout')
  // Higgsfield's rp reader applies decodeURIComponent after URLSearchParams.get.
  const signIn = new URL(decodeURIComponent(logout.searchParams.get('rp')), logout.origin)
  assert.equal(signIn.origin + signIn.pathname, 'https://higgsfield.ai/auth')
  const auth = new URL(signIn.searchParams.get('redirect_url'))
  assert.equal(auth.toString(), logout.searchParams.get('redirect_url'), 'sign-out and sign-in use the same Clerk host and intact OAuth request')
  assert.equal(auth.origin + auth.pathname, AS + '/authorize')
  assert.equal(auth.searchParams.has('prompt'), false, 'Google prompt values must not reach Higgsfield’s OAuth server')
  return auth
}
const comeBack = async (u) => { const auth = authorization(u); await realFetch(`${auth.searchParams.get('redirect_uri')}?code=${who}&state=${auth.searchParams.get('state')}`) }
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async (u) => { opened.push(u); void comeBack(u) } }, clipboard: { writeText: (u) => clip.push(u) }, safeStorage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
let bridge
const load = async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export * from '${main}/bridge/index'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  bridge = mod.exports
}

// ---- the stand-in supplier: one login server, one MCP server, accounts A, B, C ----
const MCP = 'https://mcp.higgsfield.ai/mcp', AS = 'https://clerk.higgsfield.ai'
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const credits = { A: 100, B: 900, C: 400 }
const dead = new Set() // accounts whose session the supplier ended
let refuse = null // their registration door's refusal, when it has one
let onCall = () => ({ content: [{ type: 'text', text: '{}' }] })
const toolCalls = []
global.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.includes('oauth-protected-resource')) return json({ resource: MCP, authorization_servers: [AS] })
  if (u.includes('oauth-authorization-server')) return json({ issuer: AS, authorization_endpoint: AS + '/authorize', token_endpoint: AS + '/token', registration_endpoint: AS + '/register' })
  if (u === AS + '/register') return refuse ? json(refuse, 400) : json({ client_id: 'cid' }, 201)
  if (u === AS + '/token') {
    const form = new URLSearchParams(init.body)
    if (form.get('grant_type') === 'authorization_code') return json({ access_token: 'AT-' + form.get('code'), refresh_token: 'RT-' + form.get('code'), expires_in: 3600 })
    const acct = form.get('refresh_token').slice(3)
    return dead.has(acct) ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'AT-' + acct, expires_in: 3600 })
  }
  if (u === MCP) {
    const acct = (init.headers?.Authorization ?? '').replace('Bearer AT-', '')
    if (!init.headers?.Authorization || dead.has(acct)) return new Response('', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="https://mcp.higgsfield.ai/.well-known/oauth-protected-resource"` } })
    const msg = JSON.parse(init.body)
    if (msg.id === undefined) return new Response('', { status: 202 })
    const reply = (result) => json({ jsonrpc: '2.0', id: msg.id, result })
    if (msg.method === 'initialize') return reply({ serverInfo: { name: 'hf' } })
    if (msg.method === 'tools/list') return reply({ tools: ['balance', 'media_upload', 'generate_video', 'job_status'].map((name) => ({ name })) })
    if (msg.params.name === 'balance') return reply({ structuredContent: { credits: credits[acct] } })
    toolCalls.push({ acct, tool: msg.params.name })
    return reply(onCall(acct, msg.params.name, msg.params.arguments))
  }
  return new Response('{}', { status: 404 })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = () => bridge.bridgeRows().filter((r) => r.id === 'higgsfield')
const settle = async () => { for (let i = 0; i < 200 && bridge.bridgeRows().some((r) => r.busy); i++) await sleep(10) }
const until = async (ok, what) => { for (let i = 0; i < 200; i++) { if (ok()) return; await sleep(10) } assert.fail('never happened: ' + what) }
const brief = () => rows().map((r) => [r.key, r.slot, r.label, r.loggedIn, r.balance])

;(async () => {
  // ---- the saved file from before there were several logins reads unchanged: it is login 1 ----
  const authA = { authorizationEndpoint: AS + '/authorize', tokenEndpoint: AS + '/token', clientId: 'cid', resource: MCP, accessToken: 'AT-A', refreshToken: 'RT-A', expiresAt: Date.now() + 3600_000 }
  let saved = JSON.stringify({ higgsfield: authA })
  let changed = 0
  const boot = async () => { await load(); await bridge.initBridge({ load: async () => saved, save: async (j) => { saved = j }, key: async () => undefined }, () => changed++); await settle() }
  await boot()
  assert.deepEqual(brief(), [['higgsfield', 1, 'Higgsfield', true, 100]], 'one login: one row, no number on it')
  assert.equal(rows()[0].service, 'Higgsfield')

  // ---- the ＋: the same browser login, into a new row; each login its own credit bar ----
  who = 'B'
  assert.equal(await bridge.addLogin('higgsfield'), undefined)
  assert.equal(opened.length, 1, 'the ＋ opens the supplier’s own login in his browser')
  assert.deepEqual(brief(), [['higgsfield', 1, 'Higgsfield 1', true, 100], ['higgsfield#2', 2, 'Higgsfield 2', true, 900]], 'two logins: numbered, each with its own credits')
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['higgsfield', 'higgsfield#2'], 'saved beside the first, which stays under the bare name')
  assert.equal(JSON.parse(saved).higgsfield.accessToken, 'AT-A', 'the first login is untouched')
  assert.equal(JSON.parse(saved)['higgsfield#2'].accessToken, 'AT-B')

  // ---- "copy the link": nothing opens; the link goes to the clipboard for a private window ----
  who = 'C'
  const adding = bridge.addLogin('higgsfield', true)
  await until(() => clip.length === 1, 'the link reaches the clipboard')
  assert.equal(opened.length, 1, 'the browser is not opened')
  authorization(clip[0]) // copied links also clear the remembered Higgsfield browser account
  await comeBack(clip[0]) // he pastes it into a private window and signs in as C
  assert.equal(await adding, undefined)
  assert.deepEqual(brief().map((r) => [r[2], r[4]]), [['Higgsfield 1', 100], ['Higgsfield 2', 900], ['Higgsfield 3', 400]], 'the pool is the three of them')

  // ---- a render spends the login with the most credits left, and stays on it ----
  const render = (opts = {}) => bridge.onBestLogin('higgsfield', opts, async (o) => {
    await bridge.bridgeToolCall('higgsfield', 'media_upload', {})
    const sub = await bridge.bridgeToolCall('higgsfield', 'generate_video', {})
    if (sub.isError) throw new Error(sub.content[0].text)
    o.onRequestId?.('job-1', 'higgsfield-mcp/generate_video')
    await sleep(15) // a poll wait: the login must hold across it
    await bridge.bridgeToolCall('higgsfield', 'job_status', {})
    return bridge.bridgeToolNames('higgsfield').length
  })
  const notes = [], recorded = []
  toolCalls.length = 0
  credits.B = 850 // what the render leaves on B
  assert.equal(await render({ onProgress: (m) => notes.push(m), onRequestId: (id, ep) => recorded.push([id, ep]) }), 4)
  assert.deepEqual(toolCalls, [{ acct: 'B', tool: 'media_upload' }, { acct: 'B', tool: 'generate_video' }, { acct: 'B', tool: 'job_status' }], 'upload, submit and poll all land on the fullest login')
  assert.deepEqual(notes, ['Higgsfield 2 pays (the most credits left)…'], 'the row says which login pays')
  assert.deepEqual(recorded, [['job-1', 'higgsfield-mcp/generate_video#2']], 'the job is recorded with the login that took it')
  await until(() => rows()[1].balance === 850, 'the login’s credits are read again after the render')

  // ---- the recovery asks the account that took the job, not the fullest ----
  assert.equal(bridge.loginOfEndpoint('higgsfield-mcp/generate_video#3'), 3)
  assert.equal(bridge.loginOfEndpoint('higgsfield-mcp/generate_video'), 1, 'a job from before: the first login')
  toolCalls.length = 0
  await bridge.onLogin('higgsfield', 3, () => bridge.bridgeToolCall('higgsfield', 'job_status', {}))
  await bridge.onLogin('higgsfield', 1, () => bridge.bridgeToolCall('higgsfield', 'job_status', {}))
  assert.deepEqual(toolCalls.map((c) => c.acct), ['C', 'A'])
  assert.ok(bridge.bridgeReady('higgsfield', 3) && !bridge.bridgeReady('higgsfield', 7), 'a login that is not there is not ready')

  // ---- out of credit on the fullest: the next login of the same supplier takes it ----
  onCall = (acct, tool) => (tool === 'generate_video' && acct === 'B' ? { isError: true, content: [{ type: 'text', text: 'insufficient credits for this model' }] } : { content: [{ type: 'text', text: '{}' }] })
  toolCalls.length = 0; notes.length = 0; recorded.length = 0
  await render({ onProgress: (m) => notes.push(m), onRequestId: (id, ep) => recorded.push([id, ep]) })
  assert.deepEqual(toolCalls.map((c) => c.acct + ':' + c.tool), ['B:media_upload', 'B:generate_video', 'C:media_upload', 'C:generate_video', 'C:job_status'], 'the whole render runs again on the next login')
  assert.deepEqual(notes, ['Higgsfield 2 pays (the most credits left)…', 'Higgsfield 2 declined (insufficient credits for this model) — trying Higgsfield 3…', 'Higgsfield 3 pays (the most credits left)…'])
  assert.deepEqual(recorded, [['job-1', 'higgsfield-mcp/generate_video#3']])
  // any other failure stops where it is: no second account is charged for a broken prompt
  onCall = (acct, tool) => (tool === 'generate_video' ? { isError: true, content: [{ type: 'text', text: 'prompt rejected by moderation' }] } : { content: [{ type: 'text', text: '{}' }] })
  toolCalls.length = 0
  await assert.rejects(render(), /prompt rejected by moderation/)
  assert.deepEqual(toolCalls.map((c) => c.acct), ['B', 'B'], 'one login tried, no other')
  onCall = () => ({ content: [{ type: 'text', text: '{}' }] })

  // ---- a login the supplier has ended, found out when the render reaches it: the next one takes the job ----
  dead.add('B')
  toolCalls.length = 0; notes.length = 0
  await render({ onProgress: (m) => notes.push(m) })
  assert.deepEqual(toolCalls.map((c) => c.acct), ['C', 'C', 'C'])
  assert.deepEqual(notes, ['Higgsfield 2 pays (the most credits left)…', 'Higgsfield 2 is logged out — trying Higgsfield 3…', 'Higgsfield 3 pays (the most credits left)…'])
  assert.deepEqual([rows()[1].loggedIn, rows()[1].error], [false, 'session expired — log in again'], 'and its row says so')
  // its own login button signs the same row in again
  dead.delete('B'); who = 'B'
  await bridge.loginService('higgsfield', 2)
  assert.deepEqual(brief()[1], ['higgsfield#2', 2, 'Higgsfield 2', true, 850])

  // ---- his own name for a row; it survives a restart with the logins ----
  await bridge.renameLogin('higgsfield', 2, '  Friend  ')
  assert.deepEqual(rows().map((r) => [r.label, r.name]), [['Higgsfield 1', undefined], ['Friend', 'Friend'], ['Higgsfield 3', undefined]])
  assert.equal(JSON.parse(saved)['higgsfield#2'].name, 'Friend')
  await boot() // the app restarts
  assert.deepEqual(brief().map((r) => [r[0], r[2], r[3], r[4]]), [['higgsfield', 'Higgsfield 1', true, 100], ['higgsfield#2', 'Friend', true, 850], ['higgsfield#3', 'Higgsfield 3', true, 400]], 'all three come back, names and credits')
  await bridge.renameLogin('higgsfield', 2, '')
  assert.equal(rows()[1].label, 'Higgsfield 2', 'an emptied name goes back to the number')

  // ---- logout takes one login away; the rest stay ----
  await bridge.logoutService('higgsfield', 2)
  assert.deepEqual(brief().map((r) => r[2]), ['Higgsfield 1', 'Higgsfield 3'], 'the numbers do not shift: 3 stays 3')
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['higgsfield', 'higgsfield#3'])
  await bridge.logoutService('higgsfield') // the first login
  assert.deepEqual(brief(), [['higgsfield#3', 3, 'Higgsfield', true, 400]], 'one login left: one row, plain name')
  who = 'A'
  await bridge.addLogin('higgsfield')
  assert.deepEqual(brief().map((r) => [r[0], r[2]]), [['higgsfield', 'Higgsfield 1'], ['higgsfield#3', 'Higgsfield 3']], 'a new login takes the lowest free number')

  // ---- a login the supplier ended says so on its own row, and can be taken away ----
  dead.add('C')
  await bridge.refreshAll()
  await settle()
  assert.deepEqual(rows().map((r) => [r.label, r.loggedIn, r.error]), [['Higgsfield 1', true, undefined], ['Higgsfield 3', false, 'session expired — log in again']])
  assert.ok(!('higgsfield#3' in JSON.parse(saved)), 'its dead token is not kept')
  const before = toolCalls.length
  await render()
  assert.deepEqual(toolCalls.slice(before).map((c) => c.acct), ['A', 'A', 'A'], 'a dead login never gets a render')
  await bridge.logoutService('higgsfield', 3)
  assert.deepEqual(brief().map((r) => r[2]), ['Higgsfield'])
  dead.clear()

  // ---- a refused ＋ adds no row and says why where he clicked ----
  refuse = { error: 'invalid_client_metadata', error_description: 'registrations are closed' }
  assert.equal(await bridge.addLogin('higgsfield'), 'Higgsfield refused desktop client registration (400: registrations are closed) — their MCP may only allow known web clients today')
  assert.equal(rows().length, 1)
  refuse = null
  assert.equal(await bridge.addLogin('venice'), 'Venice takes one login', 'a key row has one key')

  // ---- nobody logged in: the adapter's own words, no crash ----
  await bridge.logoutService('higgsfield')
  assert.deepEqual(brief(), [['higgsfield', 1, 'Higgsfield', false, undefined]], 'no login: the supplier’s one empty row')
  await assert.rejects(render(), /not logged in to Higgsfield — Bridge panel/)
  who = 'C'
  await bridge.loginService('higgsfield')
  assert.deepEqual(brief(), [['higgsfield', 1, 'Higgsfield', true, 400]], 'login after every account is removed completes with the newly selected account')
  assert.ok(changed > 0)

  console.log('PASS several logins per bridge: the old saved login reads as login 1; the ＋ adds a login in its own row with its own credits (in the browser, or as a copied link for a private window); a render spends the login with the most credits left and every call of it stays on that login; the job is recorded with its login and the recovery asks that one; out of credit moves to the supplier’s next login, any other failure stops; rows are renamed and survive a restart; logout takes one login away and numbers do not shift; an ended login says so; a refused ＋ adds nothing and says why')
})().catch((e) => { console.error(e); process.exitCode = 1 })
