// Models card — the ONE surface for local models (LOCAL-MODELS-PLAN, settled spec 2026-08-19).
// Registry (shared/localModels.ts) × disk state (main/modelStore.ts), rendered as fixed-height
// rows whose right-hand STATE SLOT morphs in place: ⬇ download → progress bar → ✓ ready +
// delete. Any surface that starts a model download raises this card (App: onModelsStarted).
// CANON OVER DRIFT: bible values day one — mono chrome, 9/10/11/12 type ladder, radius 4/6,
// tokens.ts spacing scale (its first importer), Section legend recipe, quiet ✕, danger delete
// through the house confirm. New glyphs ⬇ ⟳ ↗ entered the bible table (ch. 03) first.
import { useEffect, useRef, useState } from 'react'
import { LOCAL_MODELS, LTX_DISTILLED_IDS, type LocalModelDef } from '../../../shared/localModels'
import { Section } from '@koan/shared'
import { confirmDialog } from '../prompt'
import { modelWizard } from '../lib/modelWizard'
import { LoraShelf } from '@koan/shared'
import { useStore } from '../store'
import { Ic, Film, Music, Wand2, Sparkles, Trash2, Zap } from '../ui/icons'
import { spacing, radius, font } from '@koan/shared'
import ltxLogo from '../assets/models/ltx.png'
import aceLogo from '../assets/models/ace-step.jpg'
import minimaxLogo from '../assets/models/minimax.svg'

type RowState = { status: 'ready' | 'downloading' | 'none'; bytes: number; pct: number; note?: string; filesDone?: number; filesTotal?: number; bytesLeft?: number }

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
  const [loaded, setLoaded] = useState(false) // no guessed states: every row says "reading…" till the first real answer
  const [rtTest, setRtTest] = useState<'' | 'busy' | string>('')
  const [gpuPurge, setGpuPurge] = useState<'' | 'busy' | string>('')
  // every category folds (user order 2026-08-30) — the Settings card's collapse grammar verbatim
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(['runtime', 'video', 'audio', 'fx', 'loras']))
  const toggleCat = (k: string): void =>
    setOpenCats((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const refresh = (): void => {
    void window.vidancer.modelsList().then((list) => {
      const next: Record<string, RowState> = {}
      const nextErr: Record<string, string> = {}
      for (const r of list.rows) {
        next[r.id] = { status: r.status, bytes: r.bytes, pct: r.pct, filesDone: r.filesDone, filesTotal: r.filesTotal, bytesLeft: r.bytesLeft }
        // errors are remembered in MAIN (bible 12.1) — they survive card close and app
        // restart, so a mid-chain death can never read as "nothing happened"
        if (r.error) nextErr[r.id] = r.error
      }
      setRows(next)
      setErrors(nextErr)
      setEnvs(list.envs)
      setGpu(list.gpu)
      setLoaded(true)
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

  const download = (m: LocalModelDef): void => {
    // the ONE wizard (lib/modelWizard): facts — size, disk, GPU, recommendation — then the
    // row owns progress. Same flow the engine pickers fire.
    setErrors((s) => ({ ...s, [m.id]: '' }))
    void modelWizard(m.id).then(() => refresh())
  }
  // wizard handoff: scroll the requested row into view and FLASH it — arriving here must
  // visibly point at the row that caused it (user catch: the raise alone reads as nothing)
  const focusId = useStore((s) => s.modelsFocusId)
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusId) return
    document.getElementById(`vd-model-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashId(focusId)
    useStore.getState().setModelsFocus(null)
    const t = window.setTimeout(() => setFlashId(null), 1800)
    return () => window.clearTimeout(t)
  }, [focusId])
  const del = async (m: LocalModelDef, bytes: number): Promise<void> => {
    if (!(await confirmDialog(`Delete ${m.label} — frees ${fmtBytes(bytes)}, re-downloadable any time.`, { confirmLabel: 'Delete', danger: true }))) return
    await window.vidancer.modelsDelete(m.id)
    refresh()
  }

  // which LTX size RENDERS next by default (bible 12.9): the best-installed ladder pick —
  // a per-clip pin in Clip Gen's model dropdown overrides it per render
  const activeSizeId = LTX_DISTILLED_IDS.find((id) => rows[id]?.status === 'ready')

  // ---- one row grammar for every model; the state slot morphs IN PLACE, furniture never moves ----
  const Row = ({ m, indent }: { m: LocalModelDef; indent?: boolean }): React.JSX.Element => {
    const st = rows[m.id] ?? { status: 'none', bytes: 0, pct: 0 }
    const err = errors[m.id]
    const isParent = LOCAL_MODELS.some((x) => x.variantOf === m.id)
    const gated = m.needsRuntime && !isParent
    return (
      // rows FOLD, controls never shrink (bible law 4): min-height not fixed height, the state
      // slot wraps to its own right-aligned line before anything overlaps or shrinks
      <div
        id={`vd-model-${m.id}`}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: `${spacing.sm}px ${spacing.lg}px`,
          minHeight: 46,
          padding: `${spacing.sm}px 0 ${spacing.sm}px ${indent ? 30 : 0}px`,
          borderBottom: '1px solid var(--line)',
          // arrival flash (tint-of-meaning recipe, ch. 01) — fades back out over a second
          background: flashId === m.id ? 'color-mix(in srgb, var(--amber) 14%, transparent)' : 'transparent',
          transition: 'background 1s'
        }}
      >
        {/* logo slot — fixed 28px, the model's own mark; drawn category icon when it has none */}
        {!indent && (
          <span style={{ width: 28, height: 28, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: radius.sm, color: 'var(--muted)', overflow: 'hidden' }}>
            {LOGOS[m.id] ? <img src={LOGOS[m.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Ic i={CAT_ICON[m.category]} size={14} />}
          </span>
        )}
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          {/* name line carries the chips (↗ + license) so the blurb line below keeps its FULL width
              — the license chip mid-row was eating the description (user catch, live test).
              Chips WRAP under the name at narrow widths; the name always survives (user catch #2) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}>
            <span style={{ fontFamily: font.mono, fontSize: 12, color: 'var(--txt-hi)', whiteSpace: 'nowrap' }}>{m.label}</span>
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
          {/* second line: the blurb — WRAPS to full sentences, never ellipsized (user catch #2).
              Error state swaps into the same slot, contained (law 17) */}
          <div style={{ fontSize: 11, lineHeight: 1.35, color: err ? 'var(--bad)' : 'var(--dim)' }} title={err || `${m.blurb} · used by ${m.usedBy}`}>
            {err || m.blurb}
          </div>
        </div>
        {/* THE state slot — fixed width, right-aligned; states swap inside it. marginLeft auto
            keeps it right-aligned when the row folds it onto its own line */}
        <div style={{ width: 200, flex: '0 0 auto', marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md }}>
          {!loaded ? (
            <span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>reading…</span>
          ) : isParent ? (
            <span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>pick a size below</span>
          ) : st.status === 'downloading' ? (
            st.pct < 0 ? (
              // stages with no honest count — the note stands in for the bar, CLAMPED to the
              // slot (long uv lines were running across the row — user catch), full text on hover
              <span title={st.note} style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ⏳ {st.note ?? 'preparing…'}
              </span>
            ) : (
              <>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--field)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, st.pct))}%`, background: 'var(--amber)', transition: 'width .3s' }} />
                </div>
                {/* the in-flight package rides beside the bar (a 3GB torch holds one tick for
                    minutes — the name shows it's alive); falls back to the % */}
                <span title={st.note} style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--muted)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {st.note ?? `${st.pct}%`}
                </span>
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
              {m.id === activeSizeId && (
                <span title="renders next — best installed (auto); pin a size in Clip Gen's model dropdown" style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                  ● renders
                </span>
              )}
              <span style={{ fontFamily: font.mono, fontSize: 11, color: 'var(--ok)' }}>✓ ready · {fmtBytes(st.bytes)}</span>
              <span onClick={() => void del(m, st.bytes)} title={`delete — frees ${fmtBytes(st.bytes)}, re-downloadable any time`} style={{ color: 'var(--dim)', cursor: 'pointer' }}>
                <Ic i={Trash2} size={12} />
              </span>
            </>
          ) : gated ? (
            // no fake ⬇ on an impossible action (user catch: a card full of dimmed download
            // buttons reads as broken) — the row says the truth in plain text
            <span title="the model installs from this row once its engine build lands — the runtime above installs today" style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
              arrives with a later build
            </span>
          ) : (st.filesDone ?? 0) > 0 ? (
            // resume honesty (bible 12.1): landed files are KEPT and skipped — the button says
            // what a retry actually costs, never a bare "download" that reads as starting over
            <span
              className="btn vd-hbtn"
              onClick={() => void download(m)}
              title={`${st.filesDone} of ${st.filesTotal} files already on disk — resuming downloads only what's missing`}
              style={{ fontFamily: font.mono, whiteSpace: 'nowrap' }}
            >
              ⟳ resume · {st.filesDone}/{st.filesTotal} done{st.bytesLeft ? ` · ${fmtBytes(st.bytesLeft)} left` : ''}
            </span>
          ) : (
            <span className="btn vd-hbtn" onClick={() => void download(m)} title={`download once — ${m.sizeNote}`} style={{ fontFamily: font.mono, whiteSpace: 'nowrap' }}>
              ⬇ {err ? 'retry' : 'download'}{m.sizeNote ? ` · ${m.sizeNote}` : ''}
            </span>
          )}
        </div>
      </div>
    )
  }

  const catSummary = (key: string): string => {
    if (!loaded) return '…'
    const defs = LOCAL_MODELS.filter((m) => m.category === key)
    const ready = defs.filter((m) => rows[m.id]?.status === 'ready')
    const gb = ready.reduce((a, m) => a + (rows[m.id]?.bytes ?? 0), 0)
    return `${ready.length} installed${gb ? ` · ${fmtBytes(gb)}` : ''}`
  }

  return (
    <div className="vd-panel vd-scroll" style={{ height: '100%' }}>
      <div style={{ fontFamily: font.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', marginBottom: spacing.lg }}>
        <span title="every local model the app can use lives here — download once, delete any time">models</span>
      </div>
      {CATS.map((c) => {
        const parents = LOCAL_MODELS.filter((m) => m.category === c.key && !m.variantOf)
        return (
          <Section key={c.key} title={c.title} collapsible open={openCats.has(c.key)} onToggle={() => toggleCat(c.key)} right={<span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>{catSummary(c.key)}</span>}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.lg, minHeight: 30, padding: `${spacing.md}px 0 ${spacing.xs}px` }}>
                  <span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)', flex: 1 }}>
                    {!loaded ? 'reading…' : gpu ? `GPU: ${gpu.name} · ${(gpu.vramMB / 1024).toFixed(0)} GB` : 'no NVIDIA GPU found — local models will run slowly or not at all'}
                    {gpuPurge && gpuPurge !== 'busy' ? ` · ${gpuPurge}` : ''}
                  </span>
                  <span
                    className="btn vd-hbtn"
                    style={{ fontFamily: font.mono, whiteSpace: 'nowrap', ...(gpuPurge === 'busy' ? { opacity: 0.5, pointerEvents: 'none' } : {}) }}
                    title="kills every idle local model worker and frees their GPU memory — the next render just reloads"
                    onClick={() => {
                      setGpuPurge('busy')
                      void window.vidancer.modelsFreeGpu().then((free) => setGpuPurge(free === null ? 'freed' : `${(free / 1024).toFixed(1)} GB free`))
                    }}
                  >
                    {gpuPurge === 'busy' ? '⏳ freeing…' : '⏻ free GPU'}
                  </span>
                </div>
              </>
            )}
          </Section>
        )
      })}
      <LoraShelf open={openCats.has('loras')} onToggle={() => toggleCat('loras')} pickHint="Picked LoRAs render in Clip Gen (LTX only)." />
    </div>
  )
}
