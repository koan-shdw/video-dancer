import { vd } from '../api'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { ctl } from '../ui/controls'
import { audioModelsOf, audioModelFor } from '../shared/audioModels'
import { emitScoreInput, mmss } from '../shared/emitScore'
import { AudioTakeRow, TAKE_COLORS } from './shared/takeRows'
import { FloatPick } from '../ui/FloatPick'
import { ContextMenu, Section, Dropdown, type MenuEntry } from '@koan/shared'
import { Ic, ScoreIcon, Plus, Trash2, Play, Pause } from '../ui/icons'
import { modelWizard } from '../lib/modelWizard'

const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }

const mkId = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

// first-run weights per engine — the download-honesty face (law 8)
const FIRST_RUN_NOTE: Record<string, string> = {
  'ace-step-1.5': ' · first render downloads its models (~15 GB)',
  'minimax-music-3': ' · first render downloads its models (~20 GB)'
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
  // bordered cards (user order 2026-09-01) — the shared Section, same recipe as Clip Gen's
  const sec = (id: string, title: React.ReactNode, body: React.ReactNode, right?: React.ReactNode): React.JSX.Element => (
    <Section title={title} right={right} collapsible open={!closedSecs.has(id)} onToggle={() => toggleSec(id)}>
      {body}
    </Section>
  )
  // compose readiness (gated-controls law: grey WITH the reason, never fail after the click) —
  // ready = an Anthropic key, or the Co-Director switched to bridge; live via settingsRev
  const settingsRev = useStore((s) => s.settingsRev)
  const [composeReady, setComposeReady] = useState<true | string>(true)
  useEffect(() => {
    void vd().getSettings().then((s) => {
      setComposeReady(s.codirEngine === 'bridge' || s.anthropicKey ? true : 'needs the Anthropic key in Settings, or the Co-Director on bridge')
    })
  }, [settingsRev])
  const modelJobs = useStore((s) => s.modelJobs) // live install % for the local-engine gate
  // local-engine readiness: drives the render buttons + the download-honesty face (law 8)
  const [localSt, setLocalSt] = useState<Record<string, { ready: boolean; weightsIn: boolean }>>({})
  useEffect(() => {
    const load = (): void => {
      void vd().modelsList().then((l) => {
        const next: Record<string, { ready: boolean; weightsIn: boolean }> = {}
        for (const id of ['ace-step-1.5', 'minimax-music-3']) {
          const r = l.rows.find((x) => x.id === id)
          next[id] = { ready: r?.status === 'ready', weightsIn: (r?.weightsBytes ?? 0) > 1 << 30 }
        }
        setLocalSt(next)
      })
    }
    load()
    return vd().onModelsDone(load)
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
    // scores FLOAT in the empty panel to be chosen from (user design 2026-09-01); none yet = teach
    const scores = useStore.getState().project?.scoreClips ?? []
    return (
      <EmptyState>
        {scores.length > 0 ? (
          <>
            no score open — double-click one
            <FloatPick items={scores.map((s) => ({ id: s.id, label: s.name, face: <span style={{ width: 86, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', background: 'var(--bg0)', borderRadius: 4 }}><Ic i={ScoreIcon} size={22} /></span> }))} onOpen={(id) => useStore.getState().setEditorScore(id)} hint="double-click to open it here" />
          </>
        ) : (
          <>no score open — double-click a score in the Bin to edit it here</>
        )}
        <br />
        <span
          className="btn vd-hbtn"
          style={{ marginTop: 8, display: 'inline-block' }}
          onClick={() =>
            void useStore
              .getState()
              .createScoreClip()
              .then((id) => id && useStore.getState().setEditorScore(id))
          }
        >
          ＋ new score
        </span>
      </EmptyState>
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
        <div title="timestamped music directions — renders land as takes, the keeper plays on the timeline" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', marginBottom: 8 }}>
          <Ic i={ScoreIcon} size={11} /> score
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
          <>model</>,
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '0 0 auto' }}>
                {/* MODEL — Clip Gen's word, one name per mechanism (law 3); the engine's note
                    lives in the tooltip now (tooltip law 2026-09-01), no grey block */}
                <div style={lb}>model</div>
                <Dropdown
                  value={draft.recipe.engine}
                  options={audioModelsOf('music').map((m) => ({ value: m.id, label: m.label, title: m.notes }))}
                  onChange={(v) => {
                    push({ ...draft, recipe: { ...draft.recipe, engine: v } })
                    // picking an undownloaded local engine KEEPS the selection and fires the wizard
                    // (LOCAL-MODELS-PLAN phase 4) — the Models card owns the download from there
                    const am = audioModelFor(v)
                    if (am.provider === 'local') void modelWizard(am.localRuntime ?? am.id)
                  }}
                  style={{ minWidth: 170 }}
                  title={model.notes}
                />
              </div>
              {(() => {
                const isAceQ = model.id === 'ace-step-1.5'
                const isMmQ = model.id === 'minimax-music-3-local'
                const hasQ = isAceQ || isMmQ
                return (
                  <div title={hasQ ? 'best is the default — never auto-downgraded' : 'off — this engine has one quality tier'} style={{ opacity: hasQ ? 1 : 0.4, flex: '0 0 auto' }}>
                    <div style={lb}>quality</div>
                    {isMmQ ? (
                      <Dropdown
                        value={String(opt('mmQuality') ?? 'best')}
                        options={[
                          { value: 'best', label: 'best (full precision)' },
                          { value: 'fast', label: 'faster (4-bit)' }
                        ]}
                        onChange={(v) => setOpt('mmQuality', v)}
                        title="best = full precision bf16 (slow on smaller GPUs) · faster = official 4-bit on the 8B language model — much lighter, small quality cost. Your call, never auto."
                      />
                    ) : (
                      <Dropdown
                        disabled={!isAceQ}
                        value={String(opt('aceQuality') ?? 'best')}
                        options={[
                          { value: 'best', label: 'best (XL sft)' },
                          { value: 'balanced', label: 'balanced (XL turbo)' },
                          { value: 'fast', label: 'fast (2B turbo)' }
                        ]}
                        onChange={(v) => setOpt('aceQuality', v)}
                        title="best = XL sft, the top tier (offloads on smaller GPUs — slower) · balanced = XL turbo · fast = 2B turbo, drafts"
                      />
                    )}
                  </div>
                )
              })()}
            </div>
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
                <F on={!isSon} why="Sonilo scores the span — the span IS the length" label={`length (s, ≤${model.maxDurationSec})`}>
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
              <div style={lb} title="every engine reads this — genre, mood, instrumentation">style prompt</div>
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
                <div style={{ marginBottom: 10, opacity: lyricsOn ? 1 : 0.4 }} title={lyricsOn ? 'sent word for word — tags like [intro] [verse] [chorus] [outro] shape the song' : `off — ${why}`}>
                  <div style={lb}>lyrics</div>
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
          <span style={{ opacity: model.videoToMusic ? 0.55 : 1 }} title={model.videoToMusic ? 'not sent to this engine — the footage decides; beats stay as your notes and feed the other engines' : '"at second X, the music does Y" — structure guidance: engines follow the shape, not the exact tick'}>
            beats{model.videoToMusic ? ' · not sent' : ''}
          </span>,
          <>
            {/* the beat toolbar — Clip Gen's row: label · count · the buttons right, INSIDE the card */}
            <div className="lb" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span>beats</span>
              <span style={{ color: 'var(--dim)' }}>{draft.beats.length}{draft.beats.length ? ` · ${mmss(draft.beats[draft.beats.length - 1].at)}` : ''}</span>
            <span
              className="btn vd-hbtn"
              style={{ marginLeft: 'auto', ...(composeBusy || composeReady !== true ? { opacity: 0.45, pointerEvents: composeBusy ? 'none' : undefined, cursor: composeReady !== true ? 'not-allowed' : undefined } : {}) }}
              title={
                composeReady !== true
                  ? `compose is off — ${composeReady}`
                  : "WATCHES the cut this score's span covers (the span renders to a draft proxy; one Gemini watch, about a cent), reads the shots, and writes suggested beats on the cut's own rhythm — an empty score fills in place, one with beats gets a duplicate"
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
              
              onClick={(e) => {
                e.stopPropagation()
                const last = draft.beats[draft.beats.length - 1]
                push({ ...draft, beats: [...draft.beats, { id: mkId(), at: last ? last.at + 10 : 0, text: '' }] })
              }}
            >
              <Ic i={Plus} size={11} /> beat
            </span>
            </div>
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
          <span title="click = keeper · right-click = color / disable / restore recipe">takes</span>,
          <>
            {score.takes.length === 0 && <div style={{ fontSize: 11, color: 'var(--dim)' }}>no takes yet — renders land here</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {score.takes.map((t, i) => (
                <AudioTakeRow
                  key={t.id}
                  take={t}
                  index={i}
                  keeper={t.id === (score.keeperTakeId ?? score.takes[score.takes.length - 1]?.id)}
                  engineLabel={t.engine ? audioModelFor(t.engine).label : undefined}
                  dragMime="vd/score-take"
                  dragPayload={JSON.stringify({ scoreClipId: score.id, takeId: t.id })}
                  dragHint="drag → Bin scores = its own score"
                  onKeeper={() => void setScoreKeeper(score.id, t.id)}
                  onMenu={(pos) => setTakeMenu({ ...pos, takeId: t.id })}
                />
              ))}
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
