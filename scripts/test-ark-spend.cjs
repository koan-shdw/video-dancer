// list 46 (MODELARK-SPEND-SPEC-2026-10-01): what is left on BytePlus (QueryBalanceAcct) and this
// month's ModelArk spend (ListBillOverviewByProd), read on a BytePlus Access Key. The real byteplus.ts
// against a stand-in BytePlus that checks every request the way BytePlus's signing page describes it
// (canonical request, scope, key chain), written apart from byteplus.ts, and answers each call; then
// one call refused, both refused, a wrong secret, an unknown key, a dead line and a broken reply.
// Nothing is sent to BytePlus.
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
  let answer = null // what the stand-in answers ListBillOverviewByProd
  let balance = { AccountID: 2100000001, AvailableBalance: '41.20', CashBalance: '41.20', CreditLimit: '0', FreezeAmount: '0', ArrearsBalance: '0' } // … and QueryBalanceAcct
  const refuse = (code, action) => new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'r1', Action: action, Version: '2022-01-01', Service: 'billing', Region: 'ap-southeast-1', Error: { Code: code, Message: 'refused by the stand-in' } } }), { status: code === 'AccessDenied' ? 403 : 401 })
  const bp = async (url, init) => {
    seen.push({ url, init })
    if (answer instanceof Error) throw answer
    if (typeof answer === 'function') return answer()
    const action = new URL(url).searchParams.get('Action')
    const bad = verify(url, init)
    if (bad) return refuse(bad, action)
    const result = action === 'QueryBalanceAcct' ? balance : action === 'ListBillOverviewByProd' ? answer : null
    if (result === 'denied') return refuse('AccessDenied', action)
    if (!result) return refuse('InvalidActionOrVersion', action)
    return new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'r2', Action: action }, Result: result }), { status: 200 })
  }
  const call = (action) => seen.filter((x) => new URL(x.url).searchParams.get('Action') === action).at(-1)

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

  // ---- what is left, and this month's bill ----
  answer = { Total: 3, List: [
    { Product: 'ModelArk', BillingMode: '2', BillCategoryParent: 'consume', PayableAmount: '12.5', Currency: 'USD' },
    { Product: 'CDN', BillingMode: '2', BillCategoryParent: 'consume', PayableAmount: '1.00', Currency: 'USD' },
    { Product: 'ModelArk', BillingMode: '1', BillCategoryParent: 'consume', PayableAmount: '0.25', Currency: 'USD' }
  ] }
  const ok = await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)
  assert.deepEqual(ok, { ok: true, period: '2026-10', products: [{ name: 'ModelArk', amount: 12.75 }, { name: 'CDN', amount: 1 }], total: 13.75, currency: 'USD', balance: { available: 41.2, cash: 41.2, credit: 0, frozen: 0, arrears: 0 } }, JSON.stringify(ok))
  const asked = call('QueryBalanceAcct')
  assert.equal(asked.url, 'https://billing.byteplusapi.com/?Action=QueryBalanceAcct&Version=2022-01-01', 'the balance call')
  assert.equal(asked.init.method, 'POST')
  assert.equal(asked.init.body, '{}', 'it takes no parameters: an empty JSON body, signed')
  assert.equal(verify(asked.url, asked.init), null, 'signed the same way')
  const sent = call('ListBillOverviewByProd')
  assert.equal(sent.url, 'https://billing.byteplusapi.com/?Action=ListBillOverviewByProd&Version=2022-01-01', 'BytePlus billing, the bill-by-product call')
  assert.equal(sent.init.method, 'POST')
  assert.deepEqual(JSON.parse(sent.init.body), { BillPeriod: '2026-10', Limit: 300, BillCategoryParent: ['consume'] }, 'this month by the PC’s calendar, what was consumed')
  assert.equal(sent.init.headers['Content-Type'], 'application/json')
  assert.equal(sent.init.headers['X-Date'], now.toISOString().replace(/[-:]|\.[0-9]{3}/g, ''), 'X-Date is the UTC time, YYYYMMDDTHHMMSSZ')
  assert.match(sent.init.headers.Authorization, /^HMAC-SHA256 Credential=AKLTstandin\/[0-9]{8}\/ap-southeast-1\/billing\/request, SignedHeaders=host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(sent).includes(KEYS.AKLTstandin), 'the secret never travels')

  // an empty month, another currency, credit and money owed
  answer = { Total: 0, List: [] }
  const empty = await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)
  assert.ok(empty.total === 0 && empty.products.length === 0 && empty.currency === 'USD' && empty.balance.available === 41.2, 'an empty month is $0 spent: ' + JSON.stringify(empty))
  answer = { List: [{ Product: 'ModelArk', PayableAmount: '7.5', Currency: 'SGD' }] }
  balance = { AvailableBalance: '-3.5', CashBalance: '0', CreditLimit: '50', FreezeAmount: '1.25', ArrearsBalance: '3.5' }
  const owed = await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)
  assert.equal(owed.currency, 'SGD', 'the bill’s own currency')
  assert.deepEqual(owed.balance, { available: -3.5, cash: 0, credit: 50, frozen: 1.25, arrears: 3.5 }, 'every part of the balance, as BytePlus sends it')

  // ---- one call refused: the other still shows, and says why the first is missing ----
  balance = 'denied'
  answer = { List: [{ Product: 'ModelArk', PayableAmount: '2', Currency: 'USD' }] }
  const noBal = await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)
  assert.deepEqual(noBal, { ok: true, period: '2026-10', products: [{ name: 'ModelArk', amount: 2 }], total: 2, currency: 'USD', balanceError: 'BytePlus refused it: AccessDenied (refused by the stand-in)' }, 'balance refused: the month’s spend, and why: ' + JSON.stringify(noBal))
  balance = { AvailableBalance: '', CashBalance: '' }
  assert.equal((await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)).balanceError, 'BytePlus sent no balance', 'a balance with no number is not $0 left')
  balance = { AvailableBalance: '9.99' }
  answer = 'denied'
  const noBill = await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)
  assert.deepEqual(noBill, { ok: true, period: '2026-10', spendError: 'BytePlus refused it: AccessDenied (refused by the stand-in)', currency: 'USD', balance: { available: 9.99, cash: undefined, credit: undefined, frozen: undefined, arrears: undefined } }, 'bill refused: the balance, and why the spend is missing: ' + JSON.stringify(noBill))
  answer = { List: [] }
  balance = { AvailableBalance: '41.20' }

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
  assert.deepEqual(await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now), { ok: false, error: 'BytePlus sent no bill' }, 'replies with no bill and no balance are not a $0 month')
  answer = { List: [] }
  balance = 'denied'
  const both = await m.arkSpend('AKLTstandin', KEYS.AKLTstandin, bp, now)
  assert.ok(both.ok && both.total === 0 && both.balanceError, 'an empty bill with the balance refused still works: ' + JSON.stringify(both))

  console.log('ARK SPEND OK — signed the way BytePlus describes (a stand-in re-derives every signature and refuses a changed body, query or method); what is left (QueryBalanceAcct, an empty signed body: available, cash, credit limit, frozen, owed) and this month’s consumption bill summed by product, the bill’s currency, an empty month = $0; one call refused = the other still shows with the reason; both refused, a wrong secret, an unknown key, no line, a broken reply and replies with nothing in them each say so; the secret never travels; no key, no request')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
