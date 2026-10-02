// list 59 (10-02): the beta download page (beta-gate/src/index.js), the real Worker against stand-ins
// for its R2 bucket and rate limiter, with a test password. The page never carries the password or
// a file; only the right password gets an installer, streamed whole as a download; ten tries a
// minute per visitor; no password set = closed; the installers shown are the ones in the bucket.
const path = require('node:path'), assert = require('node:assert/strict'), { pathToFileURL } = require('node:url')

;(async () => {
  const worker = await import(pathToFileURL(path.resolve(__dirname, '../beta-gate/src/index.js')).href)
  const PASSWORD = 'test-password-only'
  const EXE = new Uint8Array(200_000).map((_, i) => i % 251) // stands in for the installer
  const store = new Map([['VideoDancer-Windows-Setup.exe', EXE]])
  const BUCKET = {
    async head(key) { return store.has(key) ? { size: store.get(key).length } : null },
    async get(key) {
      const b = store.get(key)
      if (!b) return null
      return { size: b.length, body: new Blob([b]).stream(), writeHttpMetadata: (h) => h.set('etag', '"x"') }
    }
  }
  const tries = new Map()
  const TRIES = { async limit({ key }) { const n = (tries.get(key) ?? 0) + 1; tries.set(key, n); return { success: n <= 10 } } }
  const env = { BUCKET, TRIES, BETA_PASSWORD: PASSWORD }
  const URL0 = 'https://vidancer-beta.example.workers.dev/'
  const post = (fields, ip = '203.0.113.7', e = env) => worker.default.fetch(new Request(URL0, { method: 'POST', body: new URLSearchParams(fields), headers: { 'cf-connecting-ip': ip } }), e)

  // ---- the page ----
  let r = await worker.default.fetch(new Request(URL0), env)
  let html = await r.text()
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'.*form-action 'self'.*frame-ancestors 'none'/)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.ok(html.includes('type="password"') && html.includes('name="file" value="VideoDancer-Windows-Setup.exe"'), 'a password box and the Windows button')
  assert.ok(!html.includes('VideoDancer-Mac.dmg'), 'no Mac button while the bucket has no Mac installer')
  assert.ok(!html.includes(PASSWORD) && !/<script/i.test(html), 'the password never reaches the page, and the page runs no script')
  assert.ok(html.includes('mailto:alex@shdw.gallery'), 'who to ask for the password')

  // ---- the password ----
  r = await post({ password: 'guess', file: 'VideoDancer-Windows-Setup.exe' })
  html = await r.text()
  assert.equal(r.status, 401)
  assert.ok(html.includes('That password isn’t right.') && !r.headers.get('content-disposition'), 'a wrong password gets a plain line, no file')
  r = await post({ password: PASSWORD + ' ', file: 'VideoDancer-Windows-Setup.exe' })
  assert.equal(r.status, 401, 'close is not right')
  r = await post({ password: PASSWORD, file: 'VideoDancer-Windows-Setup.exe' })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="VideoDancer-Windows-Setup.exe"')
  assert.equal(r.headers.get('content-length'), String(EXE.length))
  const got = new Uint8Array(await r.arrayBuffer())
  assert.ok(got.length === EXE.length && got.every((v, i) => v === EXE[i]), 'the right password gets the whole installer, byte for byte')
  r = await post({ password: PASSWORD, file: 'VideoDancer-Mac.dmg' })
  assert.equal(r.status, 404, 'an installer not in the bucket yet')
  r = await post({ password: PASSWORD, file: '../wrangler.toml' })
  assert.equal(r.status, 400, 'only the listed installers, nothing else in the bucket or beside it')

  // ---- tries are slowed: ten a minute per visitor ----
  for (let i = 0; i < 5; i++) await post({ password: 'guess', file: 'VideoDancer-Windows-Setup.exe' }) // five tries above + five = ten
  r = await post({ password: PASSWORD, file: 'VideoDancer-Windows-Setup.exe' })
  html = await r.text()
  assert.equal(r.status, 429, 'the eleventh try in a minute waits, even with the right password')
  assert.ok(html.includes('Too many tries. Wait a minute and try again.'))
  r = await post({ password: PASSWORD, file: 'VideoDancer-Windows-Setup.exe' }, '198.51.100.9')
  assert.equal(r.status, 200, 'another visitor is not held up'); await r.arrayBuffer()

  // ---- closed until the password is set; other paths and methods ----
  r = await post({ password: '', file: 'VideoDancer-Windows-Setup.exe' }, '192.0.2.1', { BUCKET, TRIES })
  assert.equal(r.status, 503, 'no password set = downloads closed, never open')
  assert.equal((await worker.default.fetch(new Request(URL0 + 'VideoDancer-Windows-Setup.exe'), env)).status, 404, 'no direct file address')
  assert.equal((await worker.default.fetch(new Request(URL0, { method: 'PUT' }), env)).status, 405)
  store.set('VideoDancer-Mac.dmg', new Uint8Array(10))
  html = await (await worker.default.fetch(new Request(URL0), env)).text()
  assert.ok(html.includes('value="VideoDancer-Mac.dmg"'), 'the Mac button shows once the bucket has the Mac installer')
  store.clear()
  html = await (await worker.default.fetch(new Request(URL0), env)).text()
  assert.ok(html.includes('The installers are being prepared.') && !html.includes('name="file"'), 'an empty bucket says so')
  assert.equal(await worker.same('a', 'a'), true)
  assert.equal(await worker.same('a', 'b'), false)

  console.log('BETA GATE OK — a password page that runs no script and never carries the password; only the right password gets the whole installer as a download; a wrong one gets a plain line; ten tries a minute per visitor; closed until the password is set; only the installers in the bucket show; no direct file address')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
