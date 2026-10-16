import { useEffect, useState } from 'react'
import { vd } from '../api'
import type { ArkSpend } from '../shared/types'

// list 46: the ModelArk chip beside fal's credit. His words (09-29): "see if we can have modelark
// credit displayed liek fal". With the BytePlus Access Key saved it shows what is left, like fal
// (BytePlus's balance), with this month's spend in its tooltip. If BytePlus refuses the balance,
// it shows the month's spend. Without the key, the link to their console, as before.
const chip: React.CSSProperties = { cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 5, padding: '3px 8px' }
const money = (n: number, cur?: string): string => `${n < 0 ? '-' : ''}${!cur || cur === 'USD' ? '$' + Math.abs(n).toFixed(2) : `${Math.abs(n).toFixed(2)} ${cur}`}`

// `again` changes when Settings closes, so a key saved there shows at once
export function ArkChip({ spend, again }: { spend: boolean; again?: unknown }): React.JSX.Element {
  const [s, setS] = useState<ArkSpend & { loading?: boolean }>({ ok: false, loading: true })
  const load = (): void => {
    setS((x) => ({ ...x, loading: true }))
    void vd()
      .arkSpend()
      .then(setS, (e: unknown) => setS({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  }
  useEffect(() => {
    if (spend) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spend, again])
  if (!spend)
    return (
      <span onClick={() => void vd().openExternal('https://console.byteplus.com/ark')} title="ModelArk connected: its balance lives in the BytePlus console (click to open) · a BytePlus Access Key in Settings shows it here" style={chip}>
        ARK ↗
      </span>
    )
  const cur = s.currency
  const b = s.balance
  const byProduct = s.products?.length ? s.products.map((p) => `${p.name} ${money(p.amount, cur)}`).join(' · ') : ''
  const spent = s.total != null ? `spent this month (${s.period}): ${money(s.total, cur)}${byProduct ? ` (${byProduct})` : ''}` : `this month’s spend: ${s.spendError}`
  const parts = b ? [b.cash != null && `cash ${money(b.cash, cur)}`, b.credit && `credit limit ${money(b.credit, cur)}`, b.frozen && `frozen ${money(b.frozen, cur)}`, b.arrears && `owed ${money(b.arrears, cur)}`].filter(Boolean) : []
  const label = s.loading ? 'ARK …' : !s.ok ? 'ARK ⚠' : b ? `ARK ${money(b.available, cur)}` : `ARK ${money(s.total ?? 0, cur)} this month`
  const title = s.loading
    ? 'reading BytePlus…'
    : !s.ok
      ? `${s.error} · click to retry`
      : b
        ? [`ModelArk: ${money(b.available, cur)} left (BytePlus’s available balance)`, ...parts, spent, 'click to refresh'].join(' · ')
        : [`ModelArk ${spent}: what BytePlus billed, not what is left`, `no balance: ${s.balanceError}`, 'click to refresh'].join(' · ')
  return (
    <span data-ark-spend onClick={load} title={title} style={{ ...chip, color: !s.loading && !s.ok ? 'var(--bad)' : 'var(--muted)' }}>
      {label}
    </span>
  )
}
