// list 46 (docs/MODELARK-SPEND-SPEC-2026-10-01.md): what ModelArk cost this month, read from
// BytePlus's bills on a second key (an Access Key from BytePlus Console → IAM → Key management, not
// the Ark key, which only runs models). The call is ListBillOverviewByProd (BytePlus's billing
// OpenAPI, Version 2022-01-01), signed the way BytePlus's own SDK signs (byteplus-nodejs-sdk-v2,
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

type BillReply = {
  ResponseMetadata?: { Error?: { Code?: string; Message?: string } }
  Result?: { List?: { Product?: string; PayableAmount?: string; Currency?: string }[] }
}

// this month's consumption bill, summed by product. A free read: it also checks a pasted key.
export async function arkSpend(ak: string, sk: string, f: Fetch = fetch, now = new Date()): Promise<ArkSpend> {
  if (!ak || !sk) return { ok: false, error: 'no BytePlus Access Key saved' }
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const req = signBilling('ListBillOverviewByProd', { BillPeriod: period, Limit: 300, BillCategoryParent: ['consume'] }, ak, sk, now)
  let r: Response
  try {
    r = await f(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(20_000) })
  } catch {
    return { ok: false, error: 'no connection to BytePlus' }
  }
  const data = (await r.json().catch(() => null)) as BillReply | null
  const err = data?.ResponseMetadata?.Error
  if (!r.ok || err || !data?.Result)
    return { ok: false, error: err?.Code ? `BytePlus refused it: ${err.Code}${err.Message ? ` (${err.Message})` : ''}` : r.ok ? 'BytePlus sent no bill' : `BytePlus billing answered ${r.status}` }
  const rows = data.Result.List ?? []
  const by = new Map<string, number>()
  for (const x of rows) by.set(x.Product || 'other', (by.get(x.Product || 'other') ?? 0) + (Number(x.PayableAmount) || 0))
  const products = [...by].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
  return { ok: true, period, total: products.reduce((t, p) => t + p.amount, 0), currency: rows.find((x) => x.Currency)?.Currency || 'USD', products }
}
