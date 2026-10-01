// list 46 (MODELARK-SPEND-SPEC-2026-10-01): this month's ModelArk spend, read from BytePlus's bills on
// a BytePlus Access Key. The real byteplus.ts against a stand-in BytePlus that checks every request
// the way BytePlus's signing page describes it (canonical request, scope, key chain), written apart
// from byteplus.ts, and answers with a bill; then a wrong secret, an unknown key, a dead line and a
// broken reply. Nothing is sent to BytePlus.
const path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export * from '${main}/byteplus'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')(require, mod, mod.exports)
  const m = mod.exports

  // ---- the stand-in BytePlus (docs.byteplus.com, "Calculating a signature") ----
  const KEYS = { AKLTstandin: 'c2VjcmV0LXN0YW5kLWlu' }
  const H = (s) => crypto.createHash('sha256').update(s).digest('hex')
  const M = (k, s) => crypto.createHmac('sha256', k).update(s).digest()
  function verify(url, init) {
    const u = new URL(url)
    const hd = { host: u.host }
    for (const [k, v] of Object.entries(init.headers)) hd[k.toLowerCase()] = String(v)
    const a = /^HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(hd.authorization || '')
    if (!a) return 'MissingAuthenticationToken'
    const [, ak, date, region, service, signedHeaders, sig] = a
    if (!(ak in KEYS)) return 'InvalidAccessKey'
    const names = signedHeaders.split(';')
    if (!names.includes('host') || !names.includes('x-date') || hd['x-date'].slice(0, 8) !== date) return 'SignatureDoesNotMatch'
    const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) // RFC 3986
    const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&')
    const canonHeaders = [...names].sort().map((n) => `${n}:${(hd[n] ?? '').trim()}\n`).join('')
    const canonical = [init.method, u.pathname || '/', query, canonHeaders, names.join(';'), H(init.body ?? '')].join('\n')
    const toSign = ['HMAC-SHA256', hd['x-date'], `${date}/${region}/${service}/request`, H(canonical)].join('\n')
    const kSigning = M(M(M(M(KEYS[ak], date), region), service), 'request')
    if (crypto.createHmac('sha256', kSigning).update(toSign).digest('hex') !== sig) return 'SignatureDoesNotMatch'
    if (hd['x-content-sha256'] !== H(init.body ?? '')) return 'SignatureDoesNotMatch'
    return null
  }
  const seen = []
  let answer = null
  const bp = async (url, init) => {
    seen.push({ url, init })
    if (answer instanceof Error) throw answer
    if (typeof answer === 'function') return answer()
    const bad = verify(url, init)
    if (bad) return new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'r1', Action: 'ListBillOverviewByProd', Version: '2022-01-01', Service: 'billing', Region: 'ap-southeast-1', Error: { Code: bad, Message: 'refused by the stand-in' } } }), { status: 401 })
    return new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'r2' }, Result: answer }), { status: 200 })
  }

  // the stand-in is not a rubber stamp: a signed request passes, the same request with one changed byte does not
  const now = new Date(2026, 9, 1, 0, 30) // local time: the first half hour of October
  const r0 = m.signBilling('ListBillOverviewByProd', { BillPeriod: '2026-10' }, 'AKLTstandin', KEYS.AKLTstandin, now)
  assert.equal(verify(r0.url, { method: 'POST', headers: r0.headers, body: r0.body }), null, 'a signed request checks out')
  assert.equal(verify(r0.url, { method: 'POST', headers: r0.headers, body: r0.body.replace('10', '09') }), 'SignatureDoesNotMatch', 'a changed body does not')
  assert.equal(verify(r0.url.replace('2022-01-01', '2022-01-02'), { method: 'POST', headers: r0.headers, body: r0.body }), 'SignatureDoesNotMatch', 'a changed query does not')
  assert.equal(verify(r0.url, { method: 'GET', headers: r0.headers, body: r0.body }), 'SignatureDoesNotMatch', 'a changed method does not')

  // ---- no key: nothing is sent ----
  assert.deepEqual(await m.arkSpend('', '', bp, now), { ok: false, error: 'no BytePlus Access Key saved' })
  assert.equal(seen.length, 0, 'no key, no request')

  // ---- this month's bill ----
  answer = { Total: 3, List: [
    { Product: 'ModelArk', BillingMode: '2', BillCategoryParent: 'consume', PayableAmount: '12.5', Currency: 'USD' },
    { Product: 'CDN', BillingMode: '2', BillCategoryParent: 'consume', PayableAmount: '1.00', Currency: 'USD' },
    { Product: 'ModelArk', BillingMode: '1', BillCategoryParent: 'consume', PayableAmount: '0.25', Currency: 'USD' }
  ] }
  const ok = await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)
  assert.deepEqual(ok, { ok: true, period: '2026-10', total: 13.75, currency: 'USD', products: [{ name: 'ModelArk', amount: 12.75 }, { name: 'CDN', amount: 1 }] }, JSON.stringify(ok))
  const sent = seen.at(-1)
  assert.equal(sent.url, 'https://billing.byteplusapi.com/?Action=ListBillOverviewByProd&Version=2022-01-01', 'BytePlus billing, the bill-by-product call')
  assert.equal(sent.init.method, 'POST')
  assert.deepEqual(JSON.parse(sent.init.body), { BillPeriod: '2026-10', Limit: 300, BillCategoryParent: ['consume'] }, 'this month by the PC’s calendar, what was consumed')
  assert.equal(sent.init.headers['Content-Type'], 'application/json')
  assert.equal(sent.init.headers['X-Date'], now.toISOString().replace(/[-:]|\.[0-9]{3}/g, ''), 'X-Date is the UTC time, YYYYMMDDTHHMMSSZ')
  assert.match(sent.init.headers.Authorization, /^HMAC-SHA256 Credential=AKLTstandin\/[0-9]{8}\/ap-southeast-1\/billing\/request, SignedHeaders=host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(sent).includes(KEYS.AKLTstandin), 'the secret never travels')

  // an empty month, another currency
  answer = { Total: 0, List: [] }
  assert.deepEqual(await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now), { ok: true, period: '2026-10', total: 0, currency: 'USD', products: [] })
  answer = { List: [{ Product: 'ModelArk', PayableAmount: '7.5', Currency: 'SGD' }] }
  assert.equal((await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)).currency, 'SGD', 'the bill’s own currency')

  // ---- refusals, in BytePlus's words ----
  const wrong = await m.arkSpend('AKLTstandin', 'not-the-secret', bp, now)
  assert.deepEqual(wrong, { ok: false, error: 'BytePlus refused it: SignatureDoesNotMatch (refused by the stand-in)' })
  const unknown = await m.arkSpend('AKLTnobody', KEYS.AKLTstandin, bp, now)
  assert.deepEqual(unknown, { ok: false, error: 'BytePlus refused it: InvalidAccessKey (refused by the stand-in)' })
  answer = new Error('getaddrinfo ENOTFOUND')
  assert.deepEqual(await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now), { ok: false, error: 'no connection to BytePlus' })
  answer = () => new Response('<html>bad gateway</html>', { status: 502 })
  assert.deepEqual(await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now), { ok: false, error: 'BytePlus billing answered 502' })
  answer = () => new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'r3' } }), { status: 200 })
  assert.deepEqual(await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now), { ok: false, error: 'BytePlus sent no bill' }, 'a reply with no bill is not a $0 month')

  console.log('ARK SPEND OK — signed the way BytePlus describes (a stand-in re-derives every signature and refuses a changed body, query or method); this month’s consumption bill summed by product, the bill’s currency, an empty month = $0; a wrong secret, an unknown key, no line, a broken reply and a reply without a bill each say so; the secret never travels; no key, no request')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
