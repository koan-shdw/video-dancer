// list 46 (docs/MODELARK-SPEND-SPEC-2026-10-01.md): what is left on BytePlus and what ModelArk cost
// this month, read on a second key (an Access Key from BytePlus Console → IAM → Key management, not
// the Ark key, which only runs models). The calls are QueryBalanceAcct and ListBillOverviewByProd
// (BytePlus's billing OpenAPI, Version 2022-01-01), signed the way BytePlus's own SDK signs (byteplus-nodejs-sdk-v2,
// sdk-core/utils/signer.ts): HMAC-SHA256 over host, x-content-sha256 and x-date, scope
// date/region/service/request. Billing is a global service: billing.byteplusapi.com, region
// ap-southeast-1 (the SDK's default), a POST with a JSON body and Action + Version in the query.
import { createHash, createHmac } from 'crypto'
import type { ArkSpend } from '@koan/vidancer-ui/shared/types'

export const BILLING_HOST = 'billing.byteplusapi.com'
const REGION = 'ap-southeast-1'
const SERVICE = 'billing'
const VERSION = '2022-01-01'
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const hmac = (k: string | Buffer, s: string): Buffer => createHmac('sha256', k).update(s).digest()

// one signed request (exported for the test)
export function signBilling(action: string, body: unknown, ak: string, sk: string, now = new Date()): { url: string; headers: Record<string, string>; body: string } {
  const xDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '') // 20201103T104027Z
  const date = xDate.slice(0, 8)
  const query = `Action=${action}&Version=${VERSION}` // sorted, nothing to escape
  const payload = JSON.stringify(body)
  const hash = sha256(payload)
  const signed = 'host;x-content-sha256;x-date'
  const canonical = ['POST', '/', query, `host:${BILLING_HOST}\nx-content-sha256:${hash}\nx-date:${xDate}\n`, signed, hash].join('\n')
  const scope = `${date}/${REGION}/${SERVICE}/request`
  const key = hmac(hmac(hmac(hmac(sk, date), REGION), SERVICE), 'request')
  const signature = createHmac('sha256', key).update(['HMAC-SHA256', xDate, scope, sha256(canonical)].join('\n')).digest('hex')
  return {
    url: `https://${BILLING_HOST}/?${query}`,
    headers: { 'Content-Type': 'application/json', 'X-Date': xDate, 'X-Content-Sha256': hash, Authorization: `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed}, Signature=${signature}` },
    body: payload
  }
}

type Bill = { List?: { Product?: string; PayableAmount?: string; Currency?: string }[] }
// QueryBalanceAcct (billing, 2022-01-01, no parameters): in BytePlus's own SDKs (Node, Go and
// Python v2, read 10-02), not on their docs pages. Amounts come as text, AccountID as a number.
type Balance = { AvailableBalance?: string; CashBalance?: string; CreditLimit?: string; FreezeAmount?: string; ArrearsBalance?: string }

// one signed read: its Result, or why there is none in BytePlus's words
async function read<T>(action: string, body: unknown, what: string, ak: string, sk: string, f: Fetch, now: Date): Promise<{ data?: T; error?: string }> {
  const req = signBilling(action, body, ak, sk, now)
  let r: Response
  try {
    r = await f(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(20_000) })
  } catch {
    return { error: 'no connection to BytePlus' }
  }
  const data = (await r.json().catch(() => null)) as { ResponseMetadata?: { Error?: { Code?: string; Message?: string } }; Result?: T } | null
  const err = data?.ResponseMetadata?.Error
  if (!r.ok || err || !data?.Result)
    return { error: err?.Code ? `BytePlus refused it: ${err.Code}${err.Message ? ` (${err.Message})` : ''}` : r.ok ? `BytePlus sent no ${what}` : `BytePlus billing answered ${r.status}` }
  return { data: data.Result }
}

// what is left (the balance) and this month's consumption bill summed by product, both free
// reads; either one checks a pasted key. Refused balance = the chip shows the month's spend.
export async function arkSpend(ak: string, sk: string, f: Fetch = fetch, now = new Date()): Promise<ArkSpend> {
  if (!ak || !sk) return { ok: false, error: 'no BytePlus Access Key saved' }
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [bill, bal] = await Promise.all([
    read<Bill>('ListBillOverviewByProd', { BillPeriod: period, Limit: 300, BillCategoryParent: ['consume'] }, 'bill', ak, sk, f, now),
    read<Balance>('QueryBalanceAcct', {}, 'balance', ak, sk, f, now)
  ])
  const num = (v?: string): number | undefined => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
  const available = num(bal.data?.AvailableBalance)
  const balanceError = bal.error ?? (available == null ? 'BytePlus sent no balance' : undefined)
  if (bill.error && balanceError) return { ok: false, error: bill.error }
  const out: ArkSpend = { ok: true, period }
  const rows = bill.data?.List ?? []
  if (bill.data) {
    const by = new Map<string, number>()
    for (const x of rows) by.set(x.Product || 'other', (by.get(x.Product || 'other') ?? 0) + (Number(x.PayableAmount) || 0))
    out.products = [...by].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
    out.total = out.products.reduce((t, p) => t + p.amount, 0)
  } else out.spendError = bill.error
  out.currency = rows.find((x) => x.Currency)?.Currency || 'USD' // the balance call names no currency: the bill's, else BytePlus's USD
  if (available != null && bal.data)
    out.balance = { available, cash: num(bal.data.CashBalance), credit: num(bal.data.CreditLimit), frozen: num(bal.data.FreezeAmount), arrears: num(bal.data.ArrearsBalance) }
  else out.balanceError = balanceError
  return out
}
