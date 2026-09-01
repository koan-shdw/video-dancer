// BRIDGE — the MCP logins panel (BRIDGE-SPEC-2026-09-01 §2), ground-up ledger redesign
// (his order 2026-09-01 after the card grid fought every width): NO cards, NO wrapping —
// a hero TOTAL POOL (est render-time trio + ONE stacked bar where each logged-in account is
// a segment sized by its estimated share) over a slim per-provider ledger. Dead accounts
// collapse to their reason. Login rows below are unchanged. Segments compare accounts by
// ESTIMATED value (his approved est basis) because raw credits from different suppliers
// don't share a unit.
import { useEffect, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { openSettingsModal } from '../panelBus'
import higgsfieldLogo from '../assets/bridge/higgsfield.png'
import magnificLogo from '../assets/bridge/magnific.png'
import artlistLogo from '../assets/bridge/artlist.png'
import runwayLogo from '../assets/bridge/runway.png'
import pikaLogo from '../assets/bridge/pika.png'
import elevenlabsLogo from '../assets/bridge/elevenlabs.png'

// each provider's own mark (same law as the Models card: the thing's logo, not an org avatar)
const LOGOS: Record<string, string> = {
  higgsfield: higgsfieldLogo,
  magnific: magnificLogo,
  artlist: artlistLogo,
  runway: runwayLogo,
  pika: pikaLogo,
  elevenlabs: elevenlabsLogo
}

const SHORT: Record<string, string> = {
  higgsfield: 'HIGGS',
  magnific: 'MAGNIFIC',
  artlist: 'ARTLIST',
  runway: 'RUNWAY',
  pika: 'PIKA',
  elevenlabs: '11LABS'
}

function fmtCredits(n: number | undefined, unit: string): string {
  if (n === undefined) return 'n/a'
  return `${n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString()} ${unit}`
}

// ROUGH credits-per-second by rung for the pool estimate (his order: "doesn't need to be 100%
// accurate, just an est"). Basis: official ByteDance Seedance rates (SEEDANCE-PRICE-AUDIT
// 2026-08-31: $0.104/s 480p · $0.231/s 720p · $0.34/s 1080p) at the ~$0.01-per-credit peg Pika
// documents (1 USD = 100 credits) and Runway approximates. Replaced by measured rates when
// probe renders teach real ones.
const EST_CREDITS_PER_SEC: Record<string, number> = { '480': 10.4, '720': 23.1, '1080': 34 }
const fmtSec = (s: number): string => (s >= 90 ? `~${Math.round(s / 60)}m` : `~${s}s`)

// per-account estimated pool weight (720p seconds — the middle rung; any rung gives the same
// SHARES since the peg is common, the label just needs one honest basis)
const poolWeight = (r: BridgeRow): number => (r.kind === 'video' && r.loggedIn && r.balance != null ? r.balance / EST_CREDITS_PER_SEC['720'] : 0)

// segment shading — mono chrome, amber family only (bible: one accent, opacity does the work)
const SEG_ALPHA = [1, 0.62, 0.8, 0.45, 0.7, 0.55]

export function BridgePanel(): React.JSX.Element {
  const [rows, setRows] = useState<BridgeRow[]>([])
  // whether ANY Claude lane is set — providers ask chat-style questions mid-render (spec §3.5)
  // and without Claude to answer them those renders fail. Re-checked on window focus so closing
  // Settings after pasting a key clears the banner.
  const [claudeLane, setClaudeLane] = useState(true)
  const [bootAt, setBootAt] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    const pull = (): void => {
      void window.vidancer.bridgeList().then((r) => live && setRows(r))
    }
    const lane = (): void => {
      void window.vidancer.getSettings().then((s) => live && setClaudeLane(s?.codirEngine === 'bridge' || !!s?.anthropicKey))
    }
    pull()
    lane()
    void window.vidancer.appBoot().then((t) => live && setBootAt(t))
    // opening the panel re-reads every logged-in balance — an upgrade made mid-session shows
    // without a logout/restart (his Runway paid upgrade sat invisible, 2026-09-01)
    void window.vidancer.bridgeRefresh().then((r) => live && setRows(r))
    const off = window.vidancer.onBridgeChanged(pull)
    window.addEventListener('focus', lane)
    return () => {
      live = false
      off()
      window.removeEventListener('focus', lane)
    }
  }, [])

  const liveRows = rows.filter((r) => r.loggedIn)
  const weights = rows.map(poolWeight)
  const pool = weights.reduce((a, b) => a + b, 0)
  const est = (rung: string): number | null => {
    const credits = rows.reduce((a, r) => a + (r.kind === 'video' && r.loggedIn && r.balance != null ? r.balance : 0), 0)
    return liveRows.some((r) => r.balance != null) ? Math.floor(credits / EST_CREDITS_PER_SEC[rung]) : null
  }
  const segments = rows
    .map((r, i) => ({ r, w: weights[i] }))
    .filter((s) => s.w > 0)
    .map((s, i) => ({ ...s, pct: (s.w / pool) * 100, alpha: SEG_ALPHA[i % SEG_ALPHA.length] }))

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* the Claude-lane banner — bridging needs an AI to interface (his brief 2026-09-01):
          shown only while NO lane is set, gone the moment one is */}
      {!claudeLane && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 14px',
            margin: '10px 12px 0',
            borderRadius: 6,
            background: 'var(--raised)',
            border: '1px solid var(--amber-dim)'
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--txt-hi)', flex: '1 1 260px' }}>
            bridging needs an AI to interface — providers ask questions mid-render that only Claude can answer
          </span>
          <span className="btn vd-hbtn" onClick={openSettingsModal} title="run it on your Claude subscription through Claude Code — set up in Settings → CO-DIRECTOR">
            ⚭ bridge your Claude
          </span>
          <span
            className="btn vd-hbtn"
            onClick={() => {
              openSettingsModal()
              void window.vidancer.openExternal('https://platform.claude.com/settings/keys')
            }}
            title="pay per use with an Anthropic API key — opens Settings and the Anthropic key page"
          >
            add API key
          </span>
        </div>
      )}

      {/* ---- the POOL hero — one stacked bar, every live account a segment ---- */}
      <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--amber)', letterSpacing: 1.5, fontWeight: 700 }}>TOTAL POOL</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--dim)', marginLeft: 'auto' }}>
            {liveRows.length} account{liveRows.length === 1 ? '' : 's'} live
          </span>
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 6, fontFamily: 'var(--mono)' }} title="estimated from the official Seedance rates — real rates land with the probe renders">
          {(['480', '720', '1080'] as const).map((rung) => {
            const s = est(rung)
            return (
              <span key={rung} style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--txt-hi)', fontWeight: 700 }}>{s != null ? fmtSec(s) : '—'}</span>
                <span style={{ color: 'var(--dim)' }}> @{rung}</span>
              </span>
            )
          })}
          <span style={{ fontSize: 10, color: 'var(--dim)', alignSelf: 'flex-end' }}>est</span>
        </div>
        {/* the stacked bar — hover a segment to name it */}
        <div
          title="the only aggregate that matters"
          style={{ display: 'flex', height: 26, marginTop: 16, marginBottom: 10, borderRadius: 13, overflow: 'hidden', background: 'var(--bg0)', border: '1px solid var(--line)' }}
        >
          {segments.map((s) => (
            <div
              key={s.r.id}
              title={`${s.r.label} — ${fmtCredits(s.r.balance, s.r.creditUnit)} · ~${Math.round(s.pct)}% of the pool (est)`}
              style={{ width: `${s.pct}%`, background: `color-mix(in srgb, var(--amber) ${Math.round(s.alpha * 100)}%, var(--bg0))`, borderRight: '1px solid var(--bg0)' }}
            />
          ))}
        </div>
        {/* legend under the bar */}
        {segments.length > 0 && (
          <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
            {segments.map((s) => (
              <span key={s.r.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--txt)' }}>
                <img src={LOGOS[s.r.id]} alt="" style={{ width: 12, height: 12, borderRadius: 3 }} />
                {SHORT[s.r.id]} <span style={{ color: 'var(--dim)' }}>{Math.round(s.pct)}%</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ---- the ledger — one slim row per provider, same scale as the pool bar ---- */}
      <div style={{ padding: '14px 16px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r) => {
          const w = poolWeight(r)
          const pct = pool > 0 ? (w / pool) * 100 : 0
          const dead = !r.loggedIn || r.blocked
          return (
            <div key={r.id} title={r.blocked} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: dead ? 0.45 : 1 }}>
              <img src={LOGOS[r.id]} alt="" style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0 }} />
              <span style={{ width: 72, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--txt-hi)', letterSpacing: 0.5, flexShrink: 0 }}>{SHORT[r.id]}</span>
              {r.blocked ? (
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>{r.blocked}</span>
              ) : !r.loggedIn ? (
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>not connected — log in below</span>
              ) : r.error && r.balance === undefined ? (
                <span style={{ fontSize: 11, color: 'var(--dim)' }} title={r.error}>
                  {fmtCredits(r.balance, r.creditUnit)}
                </span>
              ) : (
                <>
                  <span style={{ width: 130, fontSize: 11.5, fontFamily: 'var(--mono)', color: 'var(--txt-hi)', flexShrink: 0 }}>{fmtCredits(r.balance, r.creditUnit)}</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg0)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'var(--amber)' }} />
                  </div>
                  <span style={{ width: 34, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--dim)', flexShrink: 0 }}>{pool > 0 ? `${Math.round(pct)}%` : '—'}</span>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* login rows — roomy, one per provider */}
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 10 }}>
        {rows.length === 0 && <EmptyState bare>Bridge is waking up…</EmptyState>}
        {rows.map((r) => (
          <div
            key={r.id}
            title={r.blocked}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              marginBottom: 8,
              borderRadius: 6,
              background: 'var(--raised)',
              border: '1px solid var(--line)',
              opacity: r.blocked ? 0.45 : 1
            }}
          >
            {/* logo slot — fixed 28px, the provider's own mark (Models card grammar) */}
            <span style={{ width: 28, height: 28, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
              <img src={LOGOS[r.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--txt-hi)', fontWeight: 600, width: 104, flexShrink: 0 }}>{r.label}</span>
            {/* site link — a first-class chip, not a lone quiet glyph (Models card lesson) */}
            <span
              onClick={() => void window.vidancer.openExternal(r.site)}
              title={r.site}
              style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)', cursor: 'pointer', flex: '0 0 auto' }}
            >
              ↗
            </span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.busy ? (
                <span style={{ color: 'var(--amber)' }}>
                  <span className="vd-spin">◌ </span>
                  {r.loggedIn ? 'checking the account…' : 'waiting for the browser login…'}
                </span>
              ) : r.loggedIn ? (
                <span style={{ color: 'var(--ok)' }}>
                  ● logged in
                  {r.toolCount != null && <span style={{ color: 'var(--dim)' }}> · {r.toolCount} tools</span>}
                  {r.balance !== undefined && <span style={{ color: 'var(--dim)' }}> · {fmtCredits(r.balance, r.creditUnit)}</span>}
                  {r.error && (
                    <span style={{ color: 'var(--bad)' }} title={r.error}>
                      {' '}
                      · {r.error}
                    </span>
                  )}
                </span>
              ) : r.blocked ? (
                <span style={{ color: 'var(--dim)' }} title={r.blocked}>
                  ○ {r.blocked}
                </span>
              ) : r.error ? (
                <span style={{ color: 'var(--bad)' }} title={r.error}>
                  {r.error}
                </span>
              ) : (
                <span style={{ color: 'var(--dim)' }}>○ not connected</span>
              )}
            </div>
            {r.loggedIn ? (
              <span className="btn vd-hbtn" onClick={() => void window.vidancer.bridgeLogout(r.id).then(setRows)} title="forget this login (the provider session on their site is untouched)">
                logout
              </span>
            ) : (
              <span
                className="btn vd-hbtn"
                style={r.busy || r.blocked ? { opacity: 0.5, cursor: 'default' } : undefined}
                onClick={() => !r.busy && !r.blocked && void window.vidancer.bridgeLogin(r.id).then(setRows)}
                title={r.blocked ?? `log in on ${r.site.replace('https://', '')} — opens your browser, the app stays logged in after`}
              >
                login
              </span>
            )}
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: 'var(--dim)', padding: '6px 4px' }}>
          renders spend the logged-in account's own credit — pick a provider on the engine, or Bridge to auto-pick (arrives with the probes)
          {bootAt != null && (
            <span style={{ fontFamily: 'var(--mono)' }} title="when the engine core last actually restarted — if this time is old, your restart didn't take (the app refuses to run two copies; fully quit it first)">
              {' '}
              · engine core up since {new Date(bootAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
