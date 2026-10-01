import { useEffect, useState } from 'react'
import { vd } from '../api'
import type { ArkSpend } from '../shared/types'

// list 46: the ModelArk chip beside fal's credit. His words (09-29): "see if we can have modelark
// credit displayed liek fal". With the BytePlus Access Key saved it shows what BytePlus billed this
// month: what was spent, not what is left. Without it, the link to their console, as before.
const chip: React.CSSProperties = { cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 5, padding: '3px 8px' }
const money = (n: number, cur?: string): string => (!cur || cur === 'USD' ? '$' + n.toFixed(2) : `${n.toFixed(2)} ${cur}`)

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
      <span onClick={() => void vd().openExternal('https://console.byteplus.com/ark')} title="ModelArk connected: its balance lives in the BytePlus console (click to open) · a BytePlus Access Key in Settings shows this month’s spend here" style={chip}>
        ARK ↗
      </span>
    )
  const label = s.loading ? 'ARK …' : s.ok ? `ARK ${money(s.total ?? 0, s.currency)} this month` : 'ARK ⚠'
  const title = s.loading
    ? 'reading this month’s BytePlus bill…'
    : s.ok
      ? `ModelArk spend this month (${s.period}): what BytePlus billed, not what is left${s.products?.length ? ' · ' + s.products.map((p) => `${p.name} ${money(p.amount, s.currency)}`).join(' · ') : ''} · click to refresh`
      : `${s.error} · click to retry`
  return (
    <span data-ark-spend onClick={load} title={title} style={{ ...chip, color: !s.loading && !s.ok ? 'var(--bad)' : 'var(--muted)' }}>
      {label}
    </span>
  )
}
