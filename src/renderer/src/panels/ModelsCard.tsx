// Models card — the ONE surface for local models (LOCAL-MODELS-PLAN, settled spec 2026-08-19).
// Registry (shared/localModels.ts) × disk state (main/modelStore.ts), rendered as fixed-height
// rows whose right-hand STATE SLOT morphs in place: ⬇ download → progress bar → ✓ ready +
// delete. Any surface that starts a model download raises this card (App: onModelsStarted).
// CANON OVER DRIFT: bible values day one — mono chrome, 9/10/11/12 type ladder, radius 4/6,
// tokens.ts spacing scale (its first importer), Section legend recipe, quiet ✕, danger delete
// through the house confirm. New glyphs ⬇ ⟳ ↗ entered the bible table (ch. 03) first.
import { useEffect, useRef, useState } from 'react'
import { LOCAL_MODELS, type LocalModelDef } from '../../../shared/localModels'
import { Section } from '../ui/Section'
import { confirmDialog } from '../prompt'
import { Ic, Film, Music, Wand2, Sparkles, Trash2, Zap } from '../ui/icons'
import { spacing, radius, font } from '../ui/tokens'
import ltxLogo from '../assets/models/ltx.png'
import aceLogo from '../assets/models/ace-step.jpg'
import minimaxLogo from '../assets/models/minimax.svg'

type RowState = { status: 'ready' | 'downloading' | 'none'; bytes: number; pct: number; note?: string }

const CAT_ICON = { video: Film, audio: Music, fx: Wand2, loras: Sparkles, runtime: Zap } as const
// the model's OWN mark (user call: model logos, not maker/org avatars) — sourced from each
// model's site/repo. No mark of its own → the drawn category icon stays; never fake branding.
const LOGOS: Record<string, string> = { 'ltx-2.5': ltxLogo, 'ace-step-1.5': aceLogo, 'minimax-music-3': minimaxLogo }
const CATS: { key: 'runtime' | 'video' | 'audio' | 'fx'; title: string }[] = [
  { key: 'runtime', title: 'runtime' },
  { key: 'video', title: 'video' },
  { key: 'audio', title: 'audio' },
  { key: 'fx', title: 'fx — masking & utility' }
]

const fmtBytes = (n: number): string => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${Math.round(n / (1 << 20))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const chip: React.CSSProperties = { fontFamily: font.mono, fontSize: 10, color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: radius.sm, padding: '1px 5px', whiteSpace: 'nowrap' }

export function ModelsCardPanel(): React.JSX.Element {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [envs, setEnvs] = useState<{ engine: string; bytes: number }[]>([])
  const [gpu, setGpu] = useState<{ name: string; vramMB: number } | null>(null)
  const [rtTest, setRtTest] = useState<'' | 'busy' | string>('')
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const refresh = (): void => {
    void window.vidancer.modelsList().then((list) => {
      const next: Record<string, RowState> = {}
      for (const r of list.rows) next[r.id] = { status: r.status, bytes: r.bytes, pct: r.pct }
      setRows(next)
      setEnvs(list.envs)
      setGpu(list.gpu)
    })
  }
  useEffect(() => {
    refresh()
    const offP = window.vidancer.onModelsProgress((p) => {
      setRows((s) => ({ ...s, [p.id]: { status: 'downloading', bytes: 0, pct: p.pct, note: p.note } }))
    })
    const offD = window.vidancer.onModelsDone((p) => {
      setErrors((s) => ({ ...s, [p.id]: p.ok || p.error === 'canceled' ? '' : (p.error ?? 'download failed') }))
      refresh()
    })
    return () => {
      offP()
      offD()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const download = async (m: LocalModelDef): Promise<void> => {
    // phase-2 confirm: the real size, one click. Grows into the full wizard (disk/GPU/variant
    // recommendation) at plan phase 4 — same confirm shell, more facts.
    if (!(await confirmDialog(`Download ${m.label} — ${m.sizeNote} into the app's models folder? Once per model; the app stays usable.`, { confirmLabel: 'Download' }))) return
    setErrors((s) => ({ ...s, [m.id]: '' }))
    setRows((s) => ({ ...s, [m.id]: { status: 'downloading', bytes: 0, pct: 0 } }))
    void window.vidancer.modelsDownload(m.id).then(() => refresh())
  }
  const del = async (m: LocalModelDef, bytes: number): Promise<void> => {
    if (!(await confirmDialog(`Delete ${m.label} — frees ${fmtBytes(bytes)}, re-downloadable any time.`, { confirmLabel: 'Delete', danger: true }))) return
    await window.vidancer.modelsDelete(m.id)
    refresh()
  }

  // ---- one row grammar for every model; the state slot morphs IN PLACE, furniture never moves ----
  const Row = ({ m, indent }: { m: LocalModelDef; indent?: boolean }): React.JSX.Element => {
    const st = rows[m.id] ?? { status: 'none', bytes: 0, pct: 0 }
    const err = errors[m.id]
    const isParent = LOCAL_MODELS.some((x) => x.variantOf === m.id)
    const gated = m.needsRuntime && !isParent
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.lg, height: 46, paddingLeft: indent ? 30 : 0, borderBottom: '1px solid var(--line)' }}>
        {/* logo slot — fixed 28px, the model's own mark; drawn category icon when it has none */}
        {!indent && (
          <span style={{ width: 28, height: 28, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: radius.sm, color: 'var(--muted)', overflow: 'hidden' }}>
            {LOGOS[m.id] ? <img src={LOGOS[m.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Ic i={CAT_ICON[m.category]} size={14} />}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* name line carries the chips (↗ + license) so the blurb line below keeps its FULL width
              — the license chip mid-row was eating the description (user catch, live test) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: font.mono, fontSize: 12, color: 'var(--txt-hi)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
            {/* links are first-class chips, not a lone glyph (user catch: the ↗ was too quiet) */}
            {indent ? (
              <span onClick={() => void window.vidancer.openExternal(m.homepage)} title={m.homepage} style={{ fontFamily: font.mono, fontSize: 11, color: 'var(--dim)', cursor: 'pointer', flex: '0 0 auto' }}>
                ↗
              </span>
            ) : (
              (m.links ?? [{ label: 'site', url: m.homepage }]).map((l) => (
                <span key={l.label} onClick={() => void window.vidancer.openExternal(l.url)} title={l.url} style={{ ...chip, flex: '0 0 auto', cursor: 'pointer', color: 'var(--amber)' }}>
                  ↗ {l.label}
                </span>
              ))
            )}
            {!indent && <span style={{ ...chip, flex: '0 0 auto' }}>{m.license}</span>}
          </div>
          {/* second line: the blurb — or, state swapped inside the same slot, the contained error */}
          <div style={{ fontSize: 11, color: err ? 'var(--bad)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={err || `${m.blurb} · used by ${m.usedBy}`}>
            {err || m.blurb}
          </div>
        </div>
        {/* THE state slot — fixed width, right-aligned; states swap inside it */}
        <div style={{ width: 200, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md }}>
          {isParent ? (
            <span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>pick a size below</span>
          ) : st.status === 'downloading' ? (
            st.pct < 0 ? (
              // uv-owned stages have no honest byte count — the stage note stands in for the bar
              <span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>⏳ {st.note ?? 'preparing…'}</span>
            ) : (
              <>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--field)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, st.pct))}%`, background: 'var(--amber)', transition: 'width .3s' }} />
                </div>
                <span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--muted)', width: 30, textAlign: 'right' }}>{st.pct}%</span>
                <span onClick={() => void window.vidancer.modelsCancel(m.id)} title="cancel — the partial file is removed" style={{ color: 'var(--dim)', cursor: 'pointer', fontSize: 11 }}>
                  ✕
                </span>
              </>
            )
          ) : st.status === 'ready' ? (
            <>
              {m.id === 'python-runtime' && (
                <span
                  className="btn vd-hbtn"
                  style={{ fontFamily: font.mono, whiteSpace: 'nowrap', ...(rtTest === 'busy' ? { opacity: 0.5, pointerEvents: 'none' } : {}) }}
                  title="round-trips a job through a stub python worker — proves spawn, health, token, answer"
                  onClick={() => {
                    setRtTest('busy')
                    void window.vidancer.modelsRuntimeTest().then((r) => {
                      setRtTest(`${r.ok ? '✓' : '✕'} ${r.detail}`)
                      refresh()
                    })
                  }}
                >
                  {rtTest === 'busy' ? '⏳ testing…' : '▶ test'}
                </span>
              )}
              <span style={{ fontFamily: font.mono, fontSize: 11, color: 'var(--ok)' }}>✓ ready · {fmtBytes(st.bytes)}</span>
              <span onClick={() => void del(m, st.bytes)} title={`delete — frees ${fmtBytes(st.bytes)}, re-downloadable any time`} style={{ color: 'var(--dim)', cursor: 'pointer' }}>
                <Ic i={Trash2} size={12} />
              </span>
            </>
          ) : (
            <span
              className="btn vd-hbtn"
              onClick={gated ? undefined : () => void download(m)}
              title={gated ? "off — this engine's wiring arrives in a later build (the runtime above installs today)" : `download once — ${m.sizeNote}`}
              style={{ fontFamily: font.mono, whiteSpace: 'nowrap', ...(gated ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}
            >
              ⬇ {err ? 'retry' : 'download'}{m.sizeNote ? ` · ${m.sizeNote}` : ''}
            </span>
          )}
        </div>
      </div>
    )
  }

  const catSummary = (key: string): string => {
    const defs = LOCAL_MODELS.filter((m) => m.category === key)
    const ready = defs.filter((m) => rows[m.id]?.status === 'ready')
    const gb = ready.reduce((a, m) => a + (rows[m.id]?.bytes ?? 0), 0)
    return `${ready.length} installed${gb ? ` · ${fmtBytes(gb)}` : ''}`
  }

  return (
    <div className="vd-panel vd-scroll" style={{ height: '100%' }}>
      <div style={{ fontFamily: font.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', marginBottom: spacing.lg }}>
        models <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>— every local model the app can use lives here; download once, delete any time</span>
      </div>
      {CATS.map((c) => {
        const parents = LOCAL_MODELS.filter((m) => m.category === c.key && !m.variantOf)
        return (
          <Section key={c.key} title={c.title} right={<span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>{catSummary(c.key)}</span>}>
            {parents.map((m) => (
              <div key={m.id}>
                <Row m={m} />
                {LOCAL_MODELS.filter((v) => v.variantOf === m.id).map((v) => (
                  <Row key={v.id} m={v} indent />
                ))}
              </div>
            ))}
            {c.key === 'runtime' && (
              <>
                {/* provisioned engine environments — the runtime's indented rows, sized honestly */}
                {envs.map((e) => (
                  <div key={e.engine} style={{ display: 'flex', alignItems: 'center', gap: spacing.lg, height: 26, paddingLeft: 30, borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontFamily: font.mono, fontSize: 11, color: 'var(--muted)', flex: 1 }}>{e.engine} environment</span>
                    <span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>{fmtBytes(e.bytes)}</span>
                  </div>
                ))}
                {rtTest && rtTest !== 'busy' && (
                  <div style={{ fontFamily: font.mono, fontSize: 10, color: rtTest.startsWith('✓') ? 'var(--ok)' : 'var(--bad)', padding: `${spacing.sm}px 0` }}>{rtTest}</div>
                )}
                <div style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)', padding: `${spacing.sm}px 0` }}>
                  {gpu ? `GPU: ${gpu.name} · ${(gpu.vramMB / 1024).toFixed(0)} GB` : 'no NVIDIA GPU found — local models will run slowly or not at all'}
                </div>
              </>
            )}
          </Section>
        )
      })}
      <Section title="loras" right={<span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>0 installed</span>}>
        {/* empty states teach the next action (law 9) */}
        <div style={{ fontSize: 11, color: 'var(--dim)', padding: `${spacing.sm}px 0` }}>
          no loras yet — the shelf arrives with LTX: browse CivitAI's LTX 2.5 loras right here, one click installs them
        </div>
      </Section>
    </div>
  )
}
