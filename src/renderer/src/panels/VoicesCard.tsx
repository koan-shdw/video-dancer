import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { audioModelFor, audioModelsOf } from '../../../shared/audioModels'
import { MIME_AUDIO, MIME_IMAGE } from '../lib/dragDrop'
import { focusAudio } from '../audioBus'
import { confirmDialog, textPrompt } from '../prompt'
import { ctl } from '../ui/controls'
import { smpte } from '../lib/time'
import { Ic, Play, Pause, Plus, Trash2 } from '../ui/icons'

const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }

// per-1000-character rates from the fal schema reads 2026-08-20 — the cost face is honest or absent
const CHAR_RATE: Record<string, number> = { 'chatterbox-api': 0.04, 'chatterbox-multilingual': 0.025, 'f5-tts-api': 0.05 }

// ---- Voices card (rebuilt 2026-08-20 to the user's brief): sound files from a description and
// the character's image. Clip Gen's grammar exactly — voice name + new on top, SETUP, the
// description, references (image + optional clone sample), the test line, takes stacking under
// it, ★ keeper. The keeper IS the character's voice: char sheets bind it, prompts carry it. ----
export function VoicesCardPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const voice = useStore((s) => (s.editorVoiceId ? s.project?.voiceClips.find((x) => x.id === s.editorVoiceId) : undefined))
  const images = useStore((s) => s.project?.images)
  const libAudio = useStore((s) => s.project?.audio)
  const sheets = useStore((s) => s.project?.charSheets)
  const setEditorVoice = useStore((s) => s.setEditorVoice)
  const createVoiceClip = useStore((s) => s.createVoiceClip)
  const saveVoiceClip = useStore((s) => s.saveVoiceClip)
  const setVoiceKeeper = useStore((s) => s.setVoiceKeeper)
  const reportVoiceTakeDuration = useStore((s) => s.reportVoiceTakeDuration)
  const deleteVoiceTake = useStore((s) => s.deleteVoiceTake)
  const enqueueRender = useStore((s) => s.enqueueRender)

  // draft + debounced push — the ScoreCard/CharSheet editing machinery, verbatim
  const [draft, setDraft] = useState<VoiceClip | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const pendingRef = useRef<VoiceClip | null>(null)
  const flush = (): void => {
    window.clearTimeout(timer.current)
    const pend = pendingRef.current
    pendingRef.current = null
    if (pend) void useStore.getState().saveVoiceClip(pend.id, { name: pend.name, recipe: pend.recipe })
  }
  const editorVoiceId = useStore((s) => s.editorVoiceId)
  useEffect(() => {
    flush()
    setDraft(voice ? (JSON.parse(JSON.stringify(voice)) as VoiceClip) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorVoiceId])
  useEffect(() => {
    if (!voice) {
      if (editorVoiceId) setDraft(null)
      return
    }
    if (pendingRef.current) return // our edit is the newest intent
    setDraft((d) => (d && JSON.stringify(d) === JSON.stringify(voice) ? d : (JSON.parse(JSON.stringify(voice)) as VoiceClip)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), [])

  const [imgPick, setImgPick] = useState(false)
  const [imgOver, setImgOver] = useState(false)
  const [srcOver, setSrcOver] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  if (!project) return <EmptyState>open a project to design its voices</EmptyState>
  if (!voice || !draft) {
    return (
      <EmptyState>
        no voice open — 🎤 on a char sheet designs that character&apos;s voice, or double-click a 🎤 tile in the Bin
        <br />
        <span
          className="btn vd-hbtn"
          style={{ marginTop: 8, display: 'inline-block' }}
          onClick={() =>
            void useStore
              .getState()
              .createVoiceClip()
              .then((id) => id && setEditorVoice(id))
          }
        >
          <Ic i={Plus} size={11} /> new voice
        </span>
      </EmptyState>
    )
  }

  const push = (next: VoiceClip): void => {
    setDraft(next)
    pendingRef.current = next
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      pendingRef.current = null
      void saveVoiceClip(next.id, { name: next.name, recipe: next.recipe })
    }, 500)
  }
  const updR = (patch: Partial<VoiceRecipe>): void => push({ ...draft, recipe: { ...draft.recipe, ...patch } })
  const model = audioModelFor(draft.recipe.engine)
  const engines = audioModelsOf('voice')
  const im = draft.recipe.imageId ? images?.find((i) => i.id === draft.recipe.imageId) : undefined
  const refA = draft.recipe.refAudioId ? libAudio?.find((a) => a.id === draft.recipe.refAudioId) : undefined
  const boundSheets = (sheets ?? []).filter((s) => s.voiceId === draft.id)
  const testLine = draft.recipe.testLine ?? ''
  const desc = draft.recipe.desc ?? ''

  const play = (takeId: string, file: string): void => {
    const el = audioRef.current
    if (!el) return
    if (playingId === takeId && !el.paused) {
      el.pause()
      setPlayingId(null)
      return
    }
    el.src = mediaUrl(file)
    el.muted = false
    focusAudio(el) // one player sounds at a time — the house audio bus
    void el.play()
    setPlayingId(takeId)
  }

  const estCost = CHAR_RATE[model.id] != null && testLine.trim() ? (testLine.trim().length / 1000) * CHAR_RATE[model.id] : undefined
  // clone engines are satisfied by a picked sample OR any usable take — the ★ keeper becomes
  // their sample automatically (design once in Seed Audio, then Chatterbox speaks that voice)
  const hasSample = !!refA || voice.takes.some((t) => !t.disabled)
  const canRender = !!testLine.trim() && (model.voiceDesign ? !!desc.trim() || hasSample : hasSample)
  const renderWhy = !testLine.trim()
    ? 'write the test line every take reads'
    : model.voiceDesign
      ? 'describe the voice, or add a clone sample'
      : `${model.label} clones a sample — generate take 1 with Seed Audio (the ★ keeper becomes its sample), or add a ♪ sample`
  const tooLong = model.maxTextChars != null && testLine.length > model.maxTextChars
  const voiceJob = (): Parameters<typeof enqueueRender>[0] => ({
    kind: 'voice' as const,
    label: draft.name,
    engineLabel: model.label,
    thumb: im?.file,
    ...(estCost != null ? { estCost } : {}),
    payload: { voiceClipId: draft.id, engine: model.id }
  })
  const dispatch = (lane: 'now' | 'queue'): void => {
    flush() // the render must read what's on screen — commit the debounced edit first
    if (lane === 'now') useStore.getState().renderNow(voiceJob())
    else enqueueRender(voiceJob())
  }

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} onPause={() => setPlayingId(null)} style={{ display: 'none' }} />
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
        {/* ---- name + new, the Clip Gen top row ---- */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <input value={draft.name} onChange={(e) => push({ ...draft, name: e.target.value })} placeholder="voice name" style={{ ...ctl, flex: 1 }} />
          <span
            className="btn vd-hbtn"
            title="create a new voice (lands in the Bin's 🎤 section)"
            onClick={() => {
              flush()
              void createVoiceClip().then((id) => id && setEditorVoice(id))
            }}
          >
            <Ic i={Plus} size={11} /> new
          </span>
        </div>
        {boundSheets.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--gold)', marginBottom: 8 }}>⛉ bound to {boundSheets.map((s) => s.name).join(', ')} — the ★ keeper rides their clips</div>
        )}

        {/* ---- SETUP — the engine is the biggest choice, its own line ---- */}
        <div style={{ marginBottom: 8 }}>
          <div style={lb}>model</div>
          <select value={draft.recipe.engine} onChange={(e) => updR({ engine: e.target.value })} style={{ ...ctl, width: '100%' }}>
            {engines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.provider === 'local' ? ' — local (runtime lands later)' : m.provider === 'elevenlabs' ? ' — needs its key' : ''}
              </option>
            ))}
          </select>
          {model.notes && <p className="vd-hint" style={{ margin: '4px 0 0' }}>{model.notes}</p>}
          {model.priceNote && <p className="vd-hint" style={{ margin: '2px 0 0' }}>{model.priceNote}</p>}
        </div>
        {model.id === 'chatterbox-multilingual' && (
          <div style={{ marginBottom: 8 }}>
            <div style={lb}>language — e.g. english, japanese</div>
            <input
              value={typeof draft.recipe.options?.language === 'string' ? (draft.recipe.options.language as string) : ''}
              onChange={(e) => updR({ options: { ...(draft.recipe.options ?? {}), language: e.target.value.trim().toLowerCase() } })}
              placeholder="english"
              style={{ ...ctl, width: 200 }}
            />
          </div>
        )}

        {/* ---- the DESCRIPTION — what the voice IS; rides into every linking clip's YAML ---- */}
        <div style={{ marginBottom: 8 }}>
          <div style={lb}>voice description — also rides into the YAML of every clip that links a bound sheet</div>
          <textarea
            value={desc}
            onChange={(e) => updR({ desc: e.target.value || undefined })}
            rows={3}
            placeholder="e.g. a low, gravelled elder's voice — slow, deliberate cadence, dry humor underneath"
            style={{ ...ctl, width: '100%', resize: 'vertical' }}
          />
        </div>

        {/* ---- REFERENCES: the character's image + an optional clone sample ---- */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <div
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes(MIME_IMAGE)) {
                e.preventDefault()
                setImgOver(true)
              }
            }}
            onDragLeave={() => setImgOver(false)}
            onDrop={(e) => {
              const f = e.dataTransfer.getData(MIME_IMAGE)
              setImgOver(false)
              if (!f) return
              e.preventDefault()
              const hit = images?.find((i) => i.file === f)
              if (hit) updR({ imageId: hit.id })
            }}
            style={{ position: 'relative', outline: imgOver ? '2px dashed var(--amber)' : 'none', outlineOffset: 2, borderRadius: 6 }}
          >
            <div style={lb}>character image — Seed Audio hears it (design renders)</div>
            <div
              onClick={() => setImgPick((v) => !v)}
              title="the character's image — click to pick from the Library, or drag an image here"
              style={{ width: 96, height: 96, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--line2)' }}
            >
              {im ? (
                <img src={mediaUrl(im.file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ color: 'var(--dim)', fontSize: 10, textAlign: 'center', padding: 6 }}>
                  click to pick
                  <br />
                  or drag an image
                </span>
              )}
            </div>
            {im && (
              <span style={{ cursor: 'pointer', color: 'var(--dim)', fontSize: 10 }} title="unlink the image" onClick={() => updR({ imageId: undefined })}>
                ✕ {im.title}
              </span>
            )}
            {imgPick && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 220, maxHeight: 240, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                {(images ?? []).length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no Library images yet</div>}
                {(images ?? []).map((x) => (
                  <div
                    key={x.id}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      updR({ imageId: x.id })
                      setImgPick(false)
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}
                  >
                    <img src={mediaUrl(x.file)} alt="" style={{ width: 34, height: 22, objectFit: 'cover', borderRadius: 2, flex: '0 0 auto' }} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes(MIME_AUDIO)) {
                e.preventDefault()
                setSrcOver(true)
              }
            }}
            onDragLeave={() => setSrcOver(false)}
            onDrop={(e) => {
              setSrcOver(false)
              const a = e.dataTransfer.getData(MIME_AUDIO)
              if (!a) return
              e.preventDefault()
              updR({ refAudioId: a })
            }}
            style={{ minWidth: 220, outline: srcOver ? '2px dashed var(--amber)' : 'none', outlineOffset: 2, borderRadius: 6 }}
          >
            {/* the label tells the ENGINE's truth: clone engines need a sample (the ★ keeper
                stands in once a take exists); design engines treat it as optional */}
            <div style={lb}>
              {model.voiceDesign
                ? 'clone sample (optional) — a ~10-30s ♪ track whose voice is copied'
                : `clone sample — ${model.label} needs one (the ★ keeper stands in once a take exists)`}
            </div>
            <select
              value={draft.recipe.refAudioId ?? ''}
              onChange={(e) => updR({ refAudioId: e.target.value || undefined })}
              title="the ♪ Library track whose voice is copied — or drag one here"
              style={{ ...ctl, width: '100%' }}
            >
              <option value="">{(libAudio ?? []).length ? '(pick a sample…)' : '(no Library audio yet — import it in the Library panel)'}</option>
              {(libAudio ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  ♪ {a.title}
                  {a.durationSec ? ` · ${a.durationSec.toFixed(0)}s` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ---- TEST LINE — the words every take reads ---- */}
        <div style={{ marginBottom: 8 }}>
          <div style={lb}>
            test line — every take reads this{model.maxTextChars ? ` (≤${model.maxTextChars} chars on ${model.label})` : ''}
          </div>
          <textarea
            value={testLine}
            onChange={(e) => updR({ testLine: e.target.value || undefined })}
            rows={2}
            placeholder="e.g. You came here looking for a warrior. What you found is something older."
            style={{ ...ctl, width: '100%', resize: 'vertical' }}
          />
          {tooLong && <p className="vd-hint" style={{ margin: '3px 0 0', color: 'var(--bad)' }}>✕ {testLine.length} characters — {model.label} takes {model.maxTextChars}. Shorten it or switch models.</p>}
        </div>

        {/* ---- TAKES — generations stack here; the ★ keeper IS the character's voice ---- */}
        <div style={{ ...lb, marginTop: 12 }}>takes — ▶ play · ★ = THE voice (what sheets and prompts carry) · ✕ delete</div>
        {voice.takes.length === 0 && <p className="vd-hint">no takes yet — describe the voice (or add a sample) and hit ▶ Generate.</p>}
        {[...voice.takes]
          .slice()
          .reverse()
          .map((t) => {
            const isKeeper = voice.keeperTakeId === t.id
            return (
              <div
                key={t.id}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 7px', marginBottom: 3, border: '1px solid var(--line)', borderRadius: 5, background: 'var(--panel)', fontSize: 11.5, outline: isKeeper ? '1px solid var(--gold)' : 'none' }}
              >
                <span className="btn vd-hbtn" style={{ padding: '2px 7px' }} title="play this take" onClick={() => play(t.id, t.file)}>
                  <Ic i={playingId === t.id ? Pause : Play} size={11} />
                </span>
                {/* the take teaches its own length once the element knows it */}
                <TakeDur voiceId={voice.id} take={t} onLearn={reportVoiceTakeDuration} />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--body)' }}>
                  {t.snapshot?.recipe.testLine || t.snapshot?.recipe.desc || draft.name}
                </span>
                <span style={{ color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 9.5, flex: '0 0 auto' }}>{audioModelFor(t.engine ?? draft.recipe.engine).label}</span>
                <span
                  style={{ cursor: 'pointer', color: isKeeper ? 'var(--gold)' : 'var(--dim)', flex: '0 0 auto', fontSize: 13 }}
                  title={isKeeper ? '★ THE voice — sheets and prompts carry this take' : 'make this take THE voice'}
                  onClick={() => !isKeeper && void setVoiceKeeper(voice.id, t.id)}
                >
                  ★
                </span>
                <span
                  style={{ cursor: 'pointer', color: 'var(--dim)', flex: '0 0 auto' }}
                  title="delete this take (file stays on disk)"
                  onClick={async () => {
                    if (await confirmDialog('Delete this take? (undoable — Ctrl+Z)', { confirmLabel: 'Delete', danger: true })) void deleteVoiceTake(voice.id, t.id)
                  }}
                >
                  <Ic i={Trash2} size={12} />
                </span>
              </div>
            )
          })}
      </div>

      {/* the blocked-render reason, LOUD (the Clip Gen ✕-line convention — tooltips are too quiet) */}
      {(!canRender || tooLong) && (
        <div style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--bad)' }}>
          ✕ {tooLong ? `the test line is ${testLine.length} characters — ${model.label} takes ${model.maxTextChars}` : renderWhy}
        </div>
      )}
      {/* ---- the HERO, pinned (Clip Gen grammar): two-lane render, cost on the face ---- */}
      <div style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
        <span
          className="btn"
          style={{ flex: 1, textAlign: 'center', ...(canRender && !tooLong ? {} : { opacity: 0.5, cursor: 'default' }) }}
          title={canRender && !tooLong ? `starts immediately, alongside anything running — ${model.priceNote ?? 'fal'}` : tooLong ? 'the test line is over the model cap' : renderWhy}
          onClick={() => canRender && !tooLong && dispatch('now')}
        >
          {`▶ Generate · ${model.label}${estCost != null ? ` · ~$${estCost.toFixed(3)}` : ''}`}
        </span>
        <span
          className="btn"
          style={{ flex: '0 0 auto', textAlign: 'center', ...(canRender && !tooLong ? {} : { opacity: 0.5, cursor: 'default' }) }}
          title={canRender && !tooLong ? 'add to the render queue — runs in order, one at a time' : tooLong ? 'the test line is over the model cap' : renderWhy}
          onClick={() => canRender && !tooLong && dispatch('queue')}
        >
          ＋ Queue
        </span>
      </div>
    </div>
  )
}

// a take's duration chip — learns the real length once from the media element, persists it
function TakeDur({ voiceId, take, onLearn }: { voiceId: string; take: VoiceTake; onLearn: (id: string, takeId: string, sec: number) => Promise<void> }): React.JSX.Element {
  useEffect(() => {
    if (take.durationSec) return
    const el = new Audio()
    el.preload = 'metadata'
    el.src = mediaUrl(take.file)
    el.onloadedmetadata = () => {
      if (isFinite(el.duration) && el.duration > 0) void onLearn(voiceId, take.id, el.duration)
    }
    return () => {
      el.removeAttribute('src')
      el.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.id, take.durationSec])
  return <span style={{ color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 10, flex: '0 0 auto' }}>{take.durationSec ? smpte(take.durationSec) : '…'}</span>
}
