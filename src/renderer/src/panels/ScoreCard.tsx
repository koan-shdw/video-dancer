import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { ctl } from '../ui/controls'
import { audioModelsOf, audioModelFor } from '../../../shared/audioModels'
import { emitScoreInput, mmss } from '../../../shared/emitScore'
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu'
import { Ic, Plus, Trash2, Play, Pause } from '../ui/icons'
import { modelWizard } from '../lib/modelWizard'

const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }

const mkId = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

// the v14 take-card palette (same small fixed set the video takes use)
const TAKE_COLORS = ['#d9534f', '#e7a93c', '#5cb85c', '#5b9bd5']

// first-run weights per engine — the download-honesty face (law 8)
const FIRST_RUN_NOTE: Record<string, string> = {
  'ace-step-1.5': ' · first render downloads its models (~15 GB)',
  'minimax-music-3': ' · first render downloads its models (~20 GB)'
}

// themed take player — the native <audio controls> pill ignores the app theme (design catch
// 2026-08-19); this is the house transport instead: play button, thin amber progress, mono time
function TakePlayer({ file }: { file: string }): React.JSX.Element {
  const ref = useRef<HTMLAudioElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const toggle = (): void => {
    const a = ref.current
    if (!a) return
    if (a.paused) void a.play().catch(() => undefined)
    else a.pause()
  }
  return (
    // the player row is the player — its clicks never bubble into card-level actions (keeper)
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <audio
        ref={ref}
        src={mediaUrl(file)}
        preload="metadata"
        style={{ display: 'none' }}
        onTimeUpdate={() => setT(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDur(ref.current?.duration ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <span className="btn vd-hbtn" onClick={toggle} title="play / pause">
        <Ic i={playing ? Pause : Play} size={11} />
      </span>
      <div
        ref={barRef}
        onMouseDown={(e) => {
          // press seeks, and dragging SCRUBS until release (Premiere bar feel)
          const seekTo = (clientX: number): void => {
            const r = barRef.current?.getBoundingClientRect()
            const a = ref.current
            if (!r || !a || !dur) return
            a.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur
          }
          seekTo(e.clientX)
          const move = (ev: MouseEvent): void => seekTo(ev.clientX)
          const up = (): void => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
        title="seek / drag to scrub"
        style={{ flex: 1, height: 5, background: 'var(--field)', borderRadius: 3, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${dur ? (t / dur) * 100 : 0}%`, background: 'var(--amber)' }} />
      </div>
      <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--dim)', flex: '0 0 auto' }}>
        {mmss(t)} / {mmss(dur)}
      </span>
    </div>
  )
}

// ---- Score card: a score clip's single home — REBUILT 2026-08-19 onto Clip Gen's grammar
// (user call: "Score was built in its own bubble — Clip Gen is the canon"): the same ▾ section
// landmarks in the same order (takes up top, setup, prompt, beats), the hero pinned at the
// bottom. Same DOCKED-editor loading grammar as before: double-click a ♪ tile in the Bin.
export function ScoreCardPanel(): React.JSX.Element {
  const editorScoreId = useStore((s) => s.editorScoreId)
  const score = useStore((s) => (s.editorScoreId ? s.project?.scoreClips.find((x) => x.id === s.editorScoreId) : undefined))
  const saveScoreClip = useStore((s) => s.saveScoreClip)
  const setScoreKeeper = useStore((s) => s.setScoreKeeper)
  const enqueueRender = useStore((s) => s.enqueueRender)
  const composeBusy = useStore((s) => s.composeBusy)
  const [draft, setDraft] = useState<ScoreClip | null>(null)
  const [emitOpen, setEmitOpen] = useState(false)
  const [takeMenu, setTakeMenu] = useState<{ x: number; y: number; takeId: string } | null>(null)
  // section landmarks — the Clip Gen sec() recipe verbatim (collapse state is card-local)
  const [closedSecs, setClosedSecs] = useState<Set<string>>(new Set())
  const toggleSec = (id: string): void =>
    setClosedSecs((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const sec = (id: string, title: React.ReactNode, body: React.ReactNode): React.JSX.Element => {
    const closed = closedSecs.has(id)
    return (
      <div style={{ marginBottom: 8 }}>
        <div
          onClick={() => toggleSec(id)}
          title={closed ? 'expand' : 'collapse'}
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', padding: '3px 0', borderBottom: '1px solid var(--line)', marginBottom: 7 }}
        >
          <span style={{ color: 'var(--muted)', width: 10 }}>{closed ? '▸' : '▾'}</span>
          {title}
        </div>
        {!closed && body}
      </div>
    )
  }
  // compose readiness (gated-controls law: grey WITH the reason, never fail after the click) —
  // ready = an Anthropic key, or the Co-Director switched to bridge; live via settingsRev
  const settingsRev = useStore((s) => s.settingsRev)
  const [composeReady, setComposeReady] = useState<true | string>(true)
  useEffect(() => {
    void window.vidancer.getSettings().then((s) => {
      setComposeReady(s.codirEngine === 'bridge' || s.anthropicKey ? true : 'needs the Anthropic key in Settings, or the Co-Director on bridge')
    })
  }, [settingsRev])
  const modelJobs = useStore((s) => s.modelJobs) // live install % for the local-engine gate
  // local-engine readiness: drives the render buttons + the download-honesty face (law 8)
  const [localSt, setLocalSt] = useState<Record<string, { ready: boolean; weightsIn: boolean }>>({})
  useEffect(() => {
    const load = (): void => {
      void window.vidancer.modelsList().then((l) => {
        const next: Record<string, { ready: boolean; weightsIn: boolean }> = {}
        for (const id of ['ace-step-1.5', 'minimax-music-3']) {
          const r = l.rows.find((x) => x.id === id)
          next[id] = { ready: r?.status === 'ready', weightsIn: (r?.weightsBytes ?? 0) > 1 << 30 }
        }
        setLocalSt(next)
      })
    }
    load()
    return window.vidancer.onModelsDone(load)
  }, [])
  const timer = useRef<number | undefined>(undefined)
  const pendingRef = useRef<ScoreClip | null>(null)
  const flush = (): void => {
    window.clearTimeout(timer.current)
    const pend = pendingRef.current
    pendingRef.current = null
    if (pend) void useStore.getState().saveScoreClip(pend.id, { name: pend.name, beats: pend.beats, recipe: pend.recipe })
  }
  // target switched → commit any pending edit to the PREVIOUS score, then load the new one
  useEffect(() => {
    flush()
    setDraft(score ? (JSON.parse(JSON.stringify(score)) as ScoreClip) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorScoreId])
  // adopt EXTERNAL changes (undo/redo, deletion, a landed take) — but never over an in-flight local edit
  useEffect(() => {
    if (!score) {
      if (editorScoreId) setDraft(null)
      return
    }
    if (pendingRef.current) return // our edit is the newest intent
    setDraft((d) => (d && JSON.stringify(d) === JSON.stringify(score) ? d : (JSON.parse(JSON.stringify(score)) as ScoreClip)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score])
  // flush on unmount so a just-typed edit isn't lost when the panel closes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), [])

  if (!score || !draft) {
    return (
      <div className="vd-panel vd-monitor">
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>double-click a ♪ score in the Bin — or create one there — to edit it here</span>
      </div>
    )
  }

  const push = (next: ScoreClip): void => {
    setDraft(next)
    pendingRef.current = next
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      pendingRef.current = null
      void saveScoreClip(next.id, { name: next.name, beats: next.beats, recipe: next.recipe })
    }, 500)
  }
  const model = audioModelFor(draft.recipe.engine)
  // the queue-row shape both render lanes dispatch (mirrors Clip Gen's submitRender)
  const scoreJob = (): Parameters<typeof enqueueRender>[0] => ({
    kind: 'score' as const,
    label: draft.name,
    engineLabel: model.label,
    payload: { scoreClipId: draft.id, engine: model.id, durationSec: Number(opt('durationSec') ?? 60) }
  })
  const opt = (k: string): string | number | boolean | undefined => draft.recipe.options?.[k]
  const setOpt = (k: string, v: string | number | boolean): void =>
    push({ ...draft, recipe: { ...draft.recipe, options: { ...(draft.recipe.options ?? {}), [k]: v } } })
  const setBeat = (id: string, patch: Partial<ScoreBeat>): void =>
    push({ ...draft, beats: draft.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const lrId = model.localRuntime ?? ''
  const lst = localSt[lrId]

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', marginBottom: 8 }}>
          ♪ score <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>— timestamped music directions; renders land as takes, the keeper plays on the timeline</span>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={lb}>score name</div>
          <input value={draft.name} onChange={(e) => push({ ...draft, name: e.target.value })} style={{ ...ctl, width: '100%' }} />
        </div>

        {/* ---- SETUP: the ENGINE gets its own line (it's the model, the biggest choice) with
             QUALITY beside it (a model tier, not a dial — greyed when the engine has one tier);
             then the dial grid. Clip Gen's SETUP grammar fitted to audio. ---- */}
        {sec(
          'setup',
          <>setup — model · quality</>,
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 240px' }}>
                {/* MODEL — Clip Gen's word, one name per mechanism (law 3) */}
                <div style={lb}>model</div>
                <select
                  value={draft.recipe.engine}
                  onChange={(e) => {
                    push({ ...draft, recipe: { ...draft.recipe, engine: e.target.value } })
                    // picking an undownloaded local engine KEEPS the selection and fires the wizard
                    // (LOCAL-MODELS-PLAN phase 4) — the Models card owns the download from there
                    const am = audioModelFor(e.target.value)
                    if (am.provider === 'local') void modelWizard(am.localRuntime ?? am.id)
                  }}
                  style={{ ...ctl, width: '100%' }}
                  title={model.notes}
                >
                  {audioModelsOf('music').map((m) => (
                    // local engines are SELECTABLE — selection survives, the wizard/card explains
                    // what's missing; only the render button gates (gating law: reason, never hide)
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              {(() => {
                const isAceQ = model.id === 'ace-step-1.5'
                const isMmQ = model.id === 'minimax-music-3-local'
                const hasQ = isAceQ || isMmQ
                return (
                  <div title={hasQ ? undefined : 'off — this engine has one quality tier'} style={{ opacity: hasQ ? 1 : 0.4, flex: '0 0 auto' }}>
                    <div style={lb}>quality — best is the default</div>
                    {isMmQ ? (
                      <select
                        value={String(opt('mmQuality') ?? 'best')}
                        onChange={(e) => setOpt('mmQuality', e.target.value)}
                        style={{ ...ctl, width: 170 }}
                        title="best = full precision bf16 (slow on smaller GPUs) · faster = official 4-bit on the 8B language model — much lighter, small quality cost. Your call, never auto."
                      >
                        <option value="best">best (full precision)</option>
                        <option value="fast">faster (4-bit)</option>
                      </select>
                    ) : (
                      <select
                        disabled={!isAceQ}
                        value={String(opt('aceQuality') ?? 'best')}
                        onChange={(e) => setOpt('aceQuality', e.target.value)}
                        style={{ ...ctl, width: 170 }}
                        title="best = XL sft, the top tier (offloads on smaller GPUs — slower) · balanced = XL turbo · fast = 2B turbo, drafts"
                      >
                        <option value="best">best (XL sft)</option>
                        <option value="balanced">balanced (XL turbo)</option>
                        <option value="fast">fast (2B turbo)</option>
                      </select>
                    )}
                  </div>
                )
              })()}
            </div>
            {/* FIXED-HEIGHT notes slot (stable board): the engine's note swaps INSIDE a constant
                box — switching engines never pushes the fields below */}
            <div style={{ fontSize: 10.5, color: 'var(--dim)', marginBottom: 8, minHeight: 42, overflow: 'hidden' }}>{model.notes ?? ''}</div>
            {(() => {
            const F = ({ on, why, label, w, children }: { on: boolean; why: string; label: string; w?: number; children: React.ReactNode }): React.JSX.Element => (
              <div title={on ? undefined : `off — ${why}`} style={{ opacity: on ? 1 : 0.4, width: w }}>
                <div style={lb}>{label}</div>
                {children}
              </div>
            )
            const isMini = model.id === 'minimax-music-3'
            const isBeat = model.id === 'beatoven'
            const isSon = !!model.videoToMusic
            const isAce = model.id === 'ace-step-1.5'
            return (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <F on={!isSon} why="Sonilo scores the span — the span IS the length" label={`length (sec, max ${model.maxDurationSec})`}>
                  <input
                    type="number"
                    min={5}
                    max={model.maxDurationSec}
                    disabled={isSon}
                    value={Number(opt('durationSec') ?? 60)}
                    onChange={(e) => setOpt('durationSec', Math.max(5, Math.min(model.maxDurationSec, Number(e.target.value) || 60)))}
                    style={{ ...ctl, width: 100 }}
                  />
                </F>
                <F on={!!model.instrumentalToggle} why="this engine has no vocal switch" label="instrumental">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)', cursor: model.instrumentalToggle ? 'pointer' : 'default', height: 24 }}>
                    <input type="checkbox" disabled={!model.instrumentalToggle} checked={opt('isInstrumental') !== false} onChange={(e) => setOpt('isInstrumental', e.target.checked)} />
                    no vocals
                  </label>
                </F>
                <F on={isSon} why="Sonilo only" label={`prompt influence · ${Number(opt('promptInfluence') ?? 0.5).toFixed(2)}`}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={!isSon}
                    value={Number(opt('promptInfluence') ?? 0.5)}
                    onChange={(e) => setOpt('promptInfluence', Number(e.target.value))}
                    style={{ width: 130 }}
                    title="0 = the footage decides · 1 = the style prompt rules"
                  />
                </F>
                <F on={isBeat} why="Beatoven only" label="creativity (1-20)">
                  <input type="number" min={1} max={20} disabled={!isBeat} value={Number(opt('creativity') ?? 16)} onChange={(e) => setOpt('creativity', Math.max(1, Math.min(20, Number(e.target.value) || 16)))} style={{ ...ctl, width: 74 }} />
                </F>
                <F on={isBeat} why="Beatoven only" label="refinement (10-200)">
                  <input type="number" min={10} max={200} disabled={!isBeat} value={Number(opt('refinement') ?? 100)} onChange={(e) => setOpt('refinement', Math.max(10, Math.min(200, Number(e.target.value) || 100)))} style={{ ...ctl, width: 74 }} />
                </F>
                <F on={!!model.seed} why="this engine takes no seed" label="seed (blank = random)">
                  <input
                    type="number"
                    min={0}
                    disabled={!model.seed}
                    value={typeof opt('seed') === 'number' && Number(opt('seed')) >= 0 ? Number(opt('seed')) : ''}
                    onChange={(e) => setOpt('seed', e.target.value === '' ? -1 : Math.max(0, Number(e.target.value) || 0))}
                    placeholder="random"
                    style={{ ...ctl, width: 92 }}
                  />
                </F>
              </div>
            )
          })()}
          </>
        )}

        {/* ---- PROMPT & LYRICS (Clip Gen order) ---- */}
        {sec(
          'prompt',
          <>prompt & lyrics</>,
          <>
            <div style={{ marginBottom: 10 }}>
              <div style={lb}>style prompt — every engine reads this (genre, mood, instrumentation)</div>
              <textarea
                value={String(opt('styleText') ?? '')}
                onChange={(e) => setOpt('styleText', e.target.value)}
                rows={2}
                placeholder="e.g. sparse analog synth score, slow pulse, tape hiss"
                style={{ ...ctl, width: '100%', resize: 'vertical' }}
              />
            </div>
            {(() => {
              const lyricsOn = !!model.dualPrompt && opt('isInstrumental') === false
              const why = model.dualPrompt ? 'vocals are off — untick instrumental above' : 'MiniMax / ACE only'
              return (
                <div style={{ marginBottom: 10, opacity: lyricsOn ? 1 : 0.4 }} title={lyricsOn ? undefined : `off — ${why}`}>
                  <div style={lb}>lyrics — sent word for word; tags like [intro] [verse] [chorus] [outro] shape the song</div>
                  <textarea
                    value={String(opt('lyricsText') ?? '')}
                    disabled={!lyricsOn}
                    onChange={(e) => setOpt('lyricsText', e.target.value)}
                    rows={lyricsOn ? 5 : 2}
                    placeholder={'[verse]\nMorning light filtering through the pine\n[chorus]\nSoftly the world begins to breathe'}
                    style={{ ...ctl, width: '100%', resize: 'vertical', fontFamily: 'var(--mono)' }}
                  />
                </div>
              )
            })()}
            <div style={{ opacity: model.negativePrompt ? 1 : 0.4 }} title={model.negativePrompt ? undefined : 'off — Beatoven only'}>
              <div style={lb}>avoid (negative prompt)</div>
              <input value={String(opt('negativeText') ?? '')} disabled={!model.negativePrompt} onChange={(e) => setOpt('negativeText', e.target.value)} placeholder="e.g. drums, vocals" style={{ ...ctl, width: '100%' }} />
            </div>
          </>
        )}

        {/* ---- BEATS (Clip Gen order) — chips live in the section title, clicks don't collapse ---- */}
        {sec(
          'beats',
          <>
            <span style={{ flex: '1 1 auto', minWidth: 80, opacity: model.videoToMusic ? 0.55 : 1 }} title={model.videoToMusic ? 'not sent to this engine — the footage decides; beats stay as your notes and feed the other engines' : '"at second X, the music does Y" — structure guidance: engines follow the shape, not the exact tick'}>
              beats — timed directions{model.videoToMusic ? ' · not sent (footage decides)' : ''}
            </span>
            <span
              className="btn vd-hbtn"
              style={{ whiteSpace: 'nowrap', flex: '0 0 auto', textTransform: 'none', letterSpacing: 0, ...(composeBusy || composeReady !== true ? { opacity: 0.45, pointerEvents: composeBusy ? 'none' : undefined, cursor: composeReady !== true ? 'not-allowed' : undefined } : {}) }}
              title={
                composeReady !== true
                  ? `compose is off — ${composeReady}`
                  : "reads the clips this score's span covers on the active timeline and writes suggested beats — an empty score fills in place, one with beats gets a duplicate"
              }
              onClick={(e) => {
                e.stopPropagation()
                if (composeReady !== true) return
                flush()
                void useStore.getState().composeScore(draft.id)
              }}
            >
              ✨ {composeBusy ? 'composing…' : 'compose'}
            </span>
            <span
              className="btn vd-hbtn"
              style={{ whiteSpace: 'nowrap', flex: '0 0 auto', textTransform: 'none', letterSpacing: 0 }}
              onClick={(e) => {
                e.stopPropagation()
                const last = draft.beats[draft.beats.length - 1]
                push({ ...draft, beats: [...draft.beats, { id: mkId(), at: last ? last.at + 10 : 0, text: '' }] })
              }}
            >
              <Ic i={Plus} size={11} /> beat
            </span>
          </>,
          <>
            {draft.beats.length === 0 && <div style={{ fontSize: 11, color: 'var(--dim)', margin: '2px 0 6px' }}>no beats yet — “+ beat” starts the shape (00:00 is a good first one)</div>}
            {draft.beats.map((b) => (
              <div key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, opacity: model.videoToMusic ? 0.55 : 1 }}>
                <input
                  type="number"
                  min={0}
                  value={b.at}
                  onChange={(e) => setBeat(b.id, { at: Math.max(0, Number(e.target.value) || 0) })}
                  title="seconds from the score's start (rows re-sort by time when the edit settles)"
                  style={{ ...ctl, width: 66, flex: '0 0 auto' }}
                />
                <span style={{ fontSize: 9.5, color: 'var(--dim)', width: 34, flex: '0 0 auto', fontFamily: 'var(--mono)' }}>{mmss(b.at)}</span>
                <input
                  value={b.text}
                  onChange={(e) => setBeat(b.id, { text: e.target.value })}
                  placeholder="start soft and spooky / things get intense / reach a crescendo"
                  style={{ ...ctl, flex: 1 }}
                />
                <span
                  style={{ cursor: 'pointer', color: 'var(--dim)', flex: '0 0 auto' }}
                  title="delete this beat"
                  onClick={() => push({ ...draft, beats: draft.beats.filter((x) => x.id !== b.id) })}
                >
                  <Ic i={Trash2} size={12} />
                </span>
              </div>
            ))}
          </>
        )}

        {/* ---- PROOF above FIRE: the exact outgoing content sits right over the trigger ---- */}
        {(() => {
          try {
            const { input } = emitScoreInput(draft.recipe.engine, draft.beats, draft.recipe.options ?? {})
            return (
              <div style={{ margin: '10px 0 2px' }}>
                <div
                  style={{ ...lb, cursor: 'pointer', marginBottom: emitOpen ? 4 : 0 }}
                  onClick={() => setEmitOpen((v) => !v)}
                  title="the exact content the engine receives — byte-identical to what the render sends"
                >
                  {emitOpen ? '▾' : '▸'} generated from fields (sent to the engine)
                </div>
                {emitOpen && (
                  <div style={{ background: 'var(--field)', border: '1px solid var(--line)', borderRadius: 5, padding: 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {Object.entries(input)
                      .map(([k, v]) => `${k}:\n${String(v)}`)
                      .join('\n\n')}
                  </div>
                )}
              </div>
            )
          } catch (err) {
            return <div style={{ fontSize: 10, color: 'var(--dim)', margin: '10px 0 2px' }}>{err instanceof Error ? err.message : String(err)}</div>
          }
        })()}

        {/* ---- TAKES at the BOTTOM, as ROWS (user law: audio takes are played, not looked at —
             a row with a transport is their form; they live where renders land, by the hero) ---- */}
        {sec(
          'takes',
          <>takes — click = keeper · right-click: color · disable · restore recipe</>,
          <>
            {score.takes.length === 0 && <div style={{ fontSize: 11, color: 'var(--dim)' }}>no takes yet — renders land here</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {score.takes.map((t, i) => {
                const keeper = t.id === (score.keeperTakeId ?? score.takes[score.takes.length - 1]?.id)
                return (
                  <div
                    key={t.id}
                    onClick={() => void setScoreKeeper(score.id, t.id)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('vd/score-take', JSON.stringify({ scoreClipId: score.id, takeId: t.id }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setTakeMenu({ x: e.clientX, y: e.clientY, takeId: t.id })
                    }}
                    title={keeper ? 'the keeper — timelines play this take · drag → Bin scores = its own score' : 'click = make keeper · drag → Bin scores = its own score'}
                    style={{
                      border: '1px solid ' + (keeper ? 'var(--amber)' : 'var(--line)'),
                      borderLeft: t.color ? `4px solid ${t.color}` : '1px solid ' + (keeper ? 'var(--amber)' : 'var(--line)'),
                      borderRadius: 6,
                      padding: 6,
                      opacity: t.disabled ? 0.45 : 1,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
                      <span
                        style={{ cursor: 'pointer', color: keeper ? 'var(--amber)' : 'var(--dim)' }}
                        title={keeper ? 'the keeper — timelines play this take' : 'make this the keeper'}
                        onClick={() => void setScoreKeeper(score.id, t.id)}
                      >
                        ★
                      </span>
                      <span style={{ color: 'var(--txt-hi)' }}>take {i + 1}</span>
                      <span style={{ color: 'var(--dim)' }}>
                        {t.durationSec ? `${Math.round(t.durationSec)}s` : ''}
                        {t.engine ? ` · ${audioModelFor(t.engine).label}` : ''}
                        {t.disabled ? ' · disabled' : ''}
                      </span>
                    </div>
                    <TakePlayer file={t.file} />
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ---- the HERO, pinned at the bottom (Clip Gen grammar): two-lane render ---- */}
      {model.provider === 'local' ? (
        lst?.ready ? (
          <div style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
            <span
              className="btn"
              style={{ flex: 1, textAlign: 'center' }}
              title="renders on your GPU through the local runtime — free; one local job at a time"
              onClick={() => {
                flush()
                useStore.getState().renderNow(scoreJob())
              }}
            >
              {`▶ Render now · ${model.label} · free${lst.weightsIn ? '' : (FIRST_RUN_NOTE[lrId] ?? '')}`}
            </span>
            <span
              className="btn"
              style={{ flex: '0 0 auto', textAlign: 'center' }}
              title="add to the render queue — runs in order, one at a time"
              onClick={() => {
                flush()
                enqueueRender(scoreJob())
              }}
            >
              ＋ Queue
            </span>
          </div>
        ) : (
          <div style={{ margin: '8px 0 0' }}>
            {/* gating law with the LIVE reason: a running install shows its % right here */}
            <span className="btn" style={{ opacity: 0.5, pointerEvents: 'none', display: 'block', textAlign: 'center' }} title={modelJobs[lrId] !== undefined ? 'installing — the Models card shows the row' : 'its Models card row installs it'}>
              ▶ Render — {modelJobs[lrId] !== undefined ? `${model.label} installing, ${modelJobs[lrId]}%` : `install ${model.label} in the Models card first`}
            </span>
          </div>
        )
      ) : (
        <div style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
          <span
            className="btn"
            style={{ flex: 1, textAlign: 'center' }}
            title={`starts immediately, alongside anything running — ${model.priceNote ?? 'fal'}`}
            onClick={() => {
              flush() // the render must read what's on screen — commit the debounced edit first
              useStore.getState().renderNow(scoreJob())
            }}
          >
            {`▶ Render now · ${model.label}`}
          </span>
          <span
            className="btn"
            style={{ flex: '0 0 auto', textAlign: 'center' }}
            title="add to the render queue — runs in order, one at a time"
            onClick={() => {
              flush()
              enqueueRender(scoreJob())
            }}
          >
            ＋ Queue
          </span>
        </div>
      )}
      {takeMenu &&
        (() => {
          const t = score.takes.find((x) => x.id === takeMenu.takeId)
          if (!t) return null
          const entries: MenuEntry[] = [
            {
              label: <>restore recipe → editor (beats + settings from this take)</>,
              onClick: () => {
                // the take's FROZEN snapshot back into the live plan — WORKFLOW law: the plan is
                // always reachable. The take itself never changes.
                if (t.snapshot) void saveScoreClip(score.id, { beats: t.snapshot.beats, recipe: t.snapshot.recipe })
              }
            },
            { label: <>{t.disabled ? 'enable' : 'disable (skipped by keeper fallback)'}</>, onClick: () => void useStore.getState().setScoreTakeMeta(score.id, t.id, { disabled: !t.disabled }) },
            ...TAKE_COLORS.map(
              (c) =>
                ({
                  label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{t.color === c ? 'color ✓' : 'color'}</span>,
                  onClick: () => void useStore.getState().setScoreTakeMeta(score.id, t.id, { color: t.color === c ? null : c })
                }) as MenuEntry
            )
          ]
          return <ContextMenu x={takeMenu.x} y={takeMenu.y} entries={entries} onClose={() => setTakeMenu(null)} />
        })()}
    </div>
  )
}
