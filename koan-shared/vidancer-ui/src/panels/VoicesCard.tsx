import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { vd } from '../api'
import { disabledLast, dimStyle } from '../lib/disabledItems'
import { mediaUrl } from '../media'
import { openLibraryPanel } from '../panelBus'
import { audioModelFor, audioModelsOf } from '../shared/audioModels'
import { MIME_AUDIO, MIME_IMAGE } from '../lib/dragDrop'
import { ctl } from '../ui/controls'
import { Ic, Plus } from '../ui/icons'
import { AudioTakeRow, TAKE_COLORS } from './shared/takeRows'
import { FloatPick } from '../ui/FloatPick'
import { ContextMenu, Section, Dropdown, type MenuEntry } from '@koan/shared'
import { useTakeMultiSelect } from '../lib/takeSelection'
import { arrowNav } from '../lib/arrowNav'
import { isKeeper } from '../shared/keepers'
import { KeeperStar, KeepersOnlySwitch, keeperEntries, toggleKeepers, useKeepersOnly } from '../lib/keeperUi'

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

  // which supplier keys are saved (gated-controls law: grey WITH the reason) + the ready voices of
  // his ElevenLabs account, fetched when an engine that speaks in them is picked (list 19)
  const settingsRev = useStore((st) => st.settingsRev)
  const [keys, setKeys] = useState<{ fal: boolean; google: boolean; elevenlabs: boolean } | null>(null)
  useEffect(() => {
    void vd().getSettings().then((st) => setKeys({ fal: !!st?.falKey, google: !!st?.googleKey, elevenlabs: !!st?.elevenKey }))
  }, [settingsRev])
  const [libVoices, setLibVoices] = useState<{ id: string; label: string }[] | null>(null)
  const libEngine = draft && audioModelFor(draft.recipe.engine).voiceLibrary ? draft.recipe.engine : ''
  useEffect(() => {
    setLibVoices(null)
    if (libEngine) void vd().voiceVoices(libEngine).then((r) => setLibVoices(r?.ok ? (r.voices ?? []) : []))
  }, [libEngine, settingsRev])
  const [imgPick, setImgPick] = useState(false)
  const [imgOver, setImgOver] = useState(false)
  const [srcOver, setSrcOver] = useState(false)
  const [srcPick, setSrcPick] = useState(false)
  const [takeMenu, setTakeMenu] = useState<{ x: number; y: number; takeId: string; takeIds: string[] } | null>(null)
  const [keepersOnly, setKeepersOnly] = useKeepersOnly('voice') // list 6: ★ only
  const takeSelection = useTakeMultiSelect(voice?.id, voice?.takes.map((t) => t.id) ?? [])
  // bordered cards (user order 2026-09-01) — the shared Section, same recipe as Clip Gen's
  const [closedSecs, setClosedSecs] = useState<Set<string>>(new Set())
  const sec = (id: string, title: React.ReactNode, body: React.ReactNode): React.JSX.Element => (
    <Section
      title={title}
      collapsible
      open={!closedSecs.has(id)}
      onToggle={() =>
        setClosedSecs((s) => {
          const n = new Set(s)
          if (n.has(id)) n.delete(id)
          else n.add(id)
          return n
        })
      }
    >
      {body}
    </Section>
  )

  if (!project) return <EmptyState>open a project to design its voices</EmptyState>
  if (!voice || !draft) {
    // voices FLOAT in the empty panel to be chosen from (user design 2026-09-01); none yet = teach
    const voices = project.voiceClips ?? []
    return (
      <EmptyState>
        {voices.length > 0 ? (
          <>
            no voice open — double-click one
            <FloatPick
              items={voices.map((v) => {
                const face = v.recipe.imageId ? project.images.find((i) => i.id === v.recipe.imageId) : undefined
                return { id: v.id, label: v.name, file: face?.file, glyph: '🎤' }
              })}
              onOpen={(id) => setEditorVoice(id)}
              hint="double-click to open it here"
            />
          </>
        ) : (
          <>no voice open — 🎤 on a char sheet designs that character&apos;s voice, or double-click a 🎤 tile in the Bin</>
        )}
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
  const viaLabel = { fal: 'fal', elevenlabs: 'ElevenLabs', google: 'Google', local: 'Local' }[model.provider]
  const viaHint = {
    fal: 'Uses your fal API key and fal credits.',
    elevenlabs: 'Uses your ElevenLabs key and its credits. A designed or cloned voice is saved in your ElevenLabs account.',
    google: 'Uses your Google AI key (the one Watch uses). A designed voice is saved in your Google project.',
    local: 'Runs on this computer; the local voice runtime is not available yet.'
  }[model.provider]
  const engines = audioModelsOf('voice')
  const im = draft.recipe.imageId ? images?.find((i) => i.id === draft.recipe.imageId) : undefined
  const refA = draft.recipe.refAudioId ? libAudio?.find((a) => a.id === draft.recipe.refAudioId) : undefined
  const boundSheets = (sheets ?? []).filter((s) => s.voiceId === draft.id)
  const testLine = draft.recipe.testLine ?? ''
  const desc = draft.recipe.desc ?? ''

  const estCost = CHAR_RATE[model.id] != null && testLine.trim() ? (testLine.trim().length / 1000) * CHAR_RATE[model.id] : undefined
  // clone engines are satisfied by a picked sample OR any usable take — the ★ keeper becomes
  // their sample automatically (design once in Seed Audio, then Chatterbox speaks that voice)
  const hasSample = !!model.voiceClone && (!!refA || voice.takes.some((t) => !t.disabled))
  // list 18 / 19 — a supplier voice: a ready one picked here, or the one a take was designed / cloned into
  const readyVoices = model.voiceLibrary ? (libVoices ?? []) : (model.voices ?? [])
  const pickedVoice = typeof draft.recipe.options?.voice === 'string' ? draft.recipe.options.voice : ''
  // (main's rule exactly: the PLAYING take's voice, when the same supplier made it)
  const playingTake = voice.takes.find((t) => t.id === voice.keeperTakeId && !t.disabled) ?? [...voice.takes].reverse().find((t) => !t.disabled)
  const keptVoice = model.provider !== 'fal' && !!playingTake?.voiceId && audioModelFor(playingTake.engine).provider === model.provider
  const keyMissing = model.provider !== 'local' && keys != null && !keys[model.provider]
  const canRender = !keyMissing && !!testLine.trim() && (!!pickedVoice || keptVoice || (model.voiceDesign ? !!desc.trim() || hasSample : hasSample))
  const renderWhy = keyMissing
    ? `add your ${viaLabel} API key in Settings first`
    : !testLine.trim()
    ? 'write the test line every take reads'
    : model.voiceDesign
      ? model.voiceClone ? 'describe the voice, or add a clone sample' : 'describe the voice, or pick a ready voice'
      : `${model.label} clones a sample — generate take 1 with Seed Audio (the ★ keeper becomes its sample), or add a ♪ sample`
  const tooLong = model.maxTextChars != null && testLine.length > model.maxTextChars
  const voiceJob = (): Parameters<typeof enqueueRender>[0] => ({
    kind: 'voice' as const,
    label: draft.name,
    engineLabel: `${model.label} · via ${viaLabel}`,
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

        {/* ---- MODEL card — engine + its dials; notes live in the tooltip (tooltip law 2026-09-01) ---- */}
        {sec('model', 'model', <>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto' }}>
            <div style={lb}>model</div>
            <Dropdown
              value={draft.recipe.engine}
              options={engines.map((m) => ({
                value: m.id,
                label: `${m.label}${m.provider === 'local' ? ' — local (runtime lands later)' : ''}`,
                title: [m.notes, m.priceNote].filter(Boolean).join('\n') || undefined
              }))}
              onChange={(v) => updR({ engine: v })}
              title={[model.notes, model.priceNote].filter(Boolean).join('\n') || undefined}
            />
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <div style={lb}>via</div>
            <Dropdown
              value={model.provider}
              options={[{ value: model.provider, label: viaLabel }]}
              disabled
              onChange={() => {}}
              style={{ minWidth: 110 }}
              title={viaHint}
            />
          </div>
          {(model.voices || model.voiceLibrary) && (
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb} title={model.voiceLibrary ? 'a voice of your ElevenLabs account — or leave it and the description / sample makes a new one' : `one of ${model.label}’s ready voices — or leave it and the description designs a new one`}>voice</div>
              <Dropdown
                value={pickedVoice}
                options={[
                  { value: '', label: keptVoice ? 'this voice (kept from its takes)' : model.voiceClone ? 'new — from the description or sample' : 'new — designed from the description' },
                  ...(pickedVoice && !readyVoices.some((v) => v.id === pickedVoice) ? [{ value: pickedVoice, label: pickedVoice }] : []),
                  ...readyVoices.map((v) => ({ value: v.id, label: v.label }))
                ]}
                onChange={(v) => updR({ options: { ...(draft.recipe.options ?? {}), voice: v } })}
                title={model.voiceLibrary && libVoices == null ? 'reading your ElevenLabs voices…' : 'which voice speaks the test line'}
              />
            </div>
          )}
          {model.styleLine && (
            <div style={{ flex: '1 1 200px', minWidth: 160 }}>
              <div style={lb} title="how the line is delivered — steered, never read aloud. Tags like <sigh> or <short pause> go IN the test line.">style</div>
              <input
                value={typeof draft.recipe.options?.style === 'string' ? (draft.recipe.options.style as string) : ''}
                onChange={(e) => updR({ options: { ...(draft.recipe.options ?? {}), style: e.target.value } })}
                placeholder="e.g. whispered urgently"
                style={{ ...ctl, width: '100%' }}
              />
            </div>
          )}
          {model.id === 'chatterbox-multilingual' && (
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb} title="which language the voice speaks — e.g. english, japanese">language</div>
              <input
                value={typeof draft.recipe.options?.language === 'string' ? (draft.recipe.options.language as string) : ''}
                onChange={(e) => updR({ options: { ...(draft.recipe.options ?? {}), language: e.target.value.trim().toLowerCase() } })}
                placeholder="english"
                style={{ ...ctl, width: 160 }}
              />
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 7 }}>{viaHint}</div>
        </>)}

        {/* ---- VOICE card — the description, the references, the test line ---- */}
        {sec('voice', 'voice', <>
        <div style={{ marginBottom: 8 }}>
          <div style={lb} title="what the voice IS — also rides into the YAML of every clip that links a bound sheet">voice description</div>
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
            <div style={lb} title="Seed Audio hears this image on design renders — pick the character it belongs to">character image</div>
            <div
              onClick={() => ((images ?? []).length ? setImgPick((v) => !v) : openLibraryPanel())}
              title={(images ?? []).length ? "the character's image — click to pick from the Library, or drag an image here" : 'no Library images yet — click opens the Library'}
              style={{ width: 148, height: 148, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--line2)' }}
            >
              {im ? (
                <img src={mediaUrl(im.file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (images ?? []).length ? (
                <span style={{ color: 'var(--dim)', fontSize: 10, textAlign: 'center', padding: 6 }}>
                  click to pick
                  <br />
                  or drag an image
                </span>
              ) : (
                <span style={{ color: 'var(--dim)', fontSize: 10, textAlign: 'center', padding: 6 }}>
                  no Library images yet
                  <br />
                  click opens the Library
                </span>
              )}
            </div>
            {im && (
              <span style={{ cursor: 'pointer', color: 'var(--dim)', fontSize: 10 }} title="unlink the image" onClick={() => updR({ imageId: undefined })}>
                ✕ {im.title}
              </span>
            )}
            {imgPick && (images ?? []).length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 220, maxHeight: 240, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                {disabledLast(images ?? []).map((x) => (
                  <div
                    key={x.id}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      updR({ imageId: x.id })
                      setImgPick(false)
                    }}
                    title={x.disabled ? 'disabled in the Library — still pickable' : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer', ...dimStyle(x.disabled) }}
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
            style={{ position: 'relative', borderRadius: 6, outline: srcOver ? '2px dashed var(--amber)' : 'none', outlineOffset: 2, ...(!model.voiceClone && model.voiceDesign ? { opacity: 0.45 } : {}) }}
          >
            {/* the label tells the ENGINE's truth; the tooltip carries the story (tooltip law) */}
            <div style={lb} title={!model.voiceClone && model.voiceDesign ? `${model.label} can’t copy a sample — Google needs a spoken consent clip from the real speaker. The sample stays here for the engines that can.` : model.voiceDesign ? 'optional — the voice to copy' : `${model.label} clones a sample — the ★ keeper stands in once a take exists`}>
              clone sample{!model.voiceClone && model.voiceDesign ? ' (not used)' : model.voiceDesign ? ' (optional)' : ''}
            </div>
            {/* THE drag box — every media-file reference wears this, app law (2026-08-20) */}
            <div
              onClick={() => ((libAudio ?? []).length ? setSrcPick((v) => !v) : openLibraryPanel())}
              title={refA ? 'the sample whose voice is copied — click to swap it' : (libAudio ?? []).length ? 'the sample whose voice is copied — click to pick a ♪ track, or drag one here' : 'no Library audio yet — click opens the Library'}
              style={{ width: 148, height: 148, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--line2)', gap: 2 }}
            >
              {refA ? (
                <>
                  <span style={{ fontSize: 18 }}>♪</span>
                  <span style={{ fontSize: 10, color: 'var(--txt-hi)', maxWidth: 136, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{refA.title}</span>
                </>
              ) : (libAudio ?? []).length ? (
                <span style={{ color: 'var(--dim)', fontSize: 10, textAlign: 'center', padding: 6 }}>
                  click to pick
                  <br />
                  or drag a ♪ track
                </span>
              ) : (
                <span style={{ color: 'var(--dim)', fontSize: 10, textAlign: 'center', padding: 6 }}>
                  no Library audio yet
                  <br />
                  click opens the Library
                </span>
              )}
            </div>
            {refA && (
              <div style={{ fontSize: 9.5, color: 'var(--gold)', fontFamily: 'var(--mono)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, maxWidth: 148 }}>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {refA.title}
                  {refA.durationSec ? ` · ${refA.durationSec.toFixed(0)}s` : ''}
                </span>
                <span style={{ cursor: 'pointer', color: 'var(--dim)' }} title="unlink the sample" onClick={() => updR({ refAudioId: undefined })}>
                  ✕
                </span>
              </div>
            )}
            {srcPick && (libAudio ?? []).length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 220, maxHeight: 240, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                {disabledLast(libAudio ?? []).map((a) => (
                  <div
                    key={a.id}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      updR({ refAudioId: a.id })
                      setSrcPick(false)
                    }}
                    title={a.disabled ? 'disabled in the Library — still pickable' : undefined}
                    style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280, ...dimStyle(a.disabled) }}
                  >
                    ♪ {a.title}
                    {a.durationSec ? ` · ${a.durationSec.toFixed(0)}s` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- TEST LINE — the words every take reads ---- */}
        <div style={{ marginBottom: 8 }}>
          <div style={lb} title={`every take reads this line${model.maxTextChars ? ` — ≤${model.maxTextChars} characters on ${model.label}` : ''}`}>
            test line
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
        </>)}

        {/* ---- TAKES card — the standard rows (panels/shared/takeRows: the Score grammar, one
             component for every audio-take card — improve it there, both cards follow) ---- */}
        {sec('takes', <span title="click = keeper + plays (a flag — many per set; the last flagged plays) · ~ = flag / unflag the selected · a lit ★ = click to unflag · ★ only = just the keepers · Ctrl/⌘-click = add/remove · Shift-click = range · right-click = color / disable / restore recipe · the ★ keeper IS the voice">takes{takeSelection.selectedIds.length > 1 ? ` · ${takeSelection.selectedIds.length} selected` : ''}<KeepersOnlySwitch on={keepersOnly} onChange={setKeepersOnly} /></span>, <>
        {voice.takes.length === 0 && <p className="vd-hint">no takes yet — describe the voice (or add a sample) and hit ▶ Generate.</p>}
        <div {...arrowNav((id) => takeSelection.selectOnly(id), (id) => toggleKeepers('voice', voice.id, takeSelection.selectedIds.length ? takeSelection.selectedIds : id ? [id] : [], null))} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {voice.takes.map((t, i) => (keepersOnly && !isKeeper(voice, t.id) ? null : (
            <AudioTakeRow
              key={t.id}
              take={t}
              index={i}
              keeper={isKeeper(voice, t.id)}
                  playing={t.id === (voice.keeperTakeId ?? voice.takes[voice.takes.length - 1]?.id)}
                  onUnflag={() => toggleKeepers('voice', voice.id, [t.id], false)}
              engineLabel={audioModelFor(t.engine ?? draft.recipe.engine).label}
              dragMime="vd/voice-take"
              dragPayload={JSON.stringify({ voiceClipId: voice.id, takeId: t.id })}
              dragHint="drag → Bin voices = its own voice"
              onKeeper={() => void setVoiceKeeper(voice.id, t.id)}
              selected={takeSelection.isSelected(t.id)}
              onSelect={(e) => takeSelection.select(e, t.id)}
              onMenu={(pos) => {
                const takeIds = takeSelection.contextIds(t.id)
                if (!takeSelection.isSelected(t.id)) takeSelection.selectOnly(t.id)
                setTakeMenu({ ...pos, takeId: t.id, takeIds })
              }}
              onDuration={(sec) => void reportVoiceTakeDuration(voice.id, t.id, sec)}
            />
          )))}
        </div>
        </>)}
      </div>

      {takeMenu &&
        (() => {
          const t = voice.takes.find((x) => x.id === takeMenu.takeId)
          if (!t) return null
          const ids = takeMenu.takeIds.filter((id) => voice.takes.some((take) => take.id === id))
          const selected = ids.map((id) => voice.takes.find((take) => take.id === id)).filter((take): take is VoiceTake => !!take)
          const batch = ids.length > 1
          const label = batch ? `${ids.length} selected takes` : 'take'
          const updateSelected = (patch: { color?: string | null; disabled?: boolean }): void => {
            void (async () => {
              for (const id of ids) await useStore.getState().setVoiceTakeMeta(voice.id, id, patch)
            })()
          }
          const entries: MenuEntry[] = [
            ...keeperEntries('voice', voice, ids), // list 6: ★ keeper / ☆ not a keeper
            {
              label: <>restore recipe → card (description + settings from this take)</>,
              onClick: () => {
                // the take's FROZEN snapshot back into the live recipe — the take itself never changes
                if (t.snapshot) void saveVoiceClip(voice.id, { recipe: t.snapshot.recipe })
              }
            },
            { label: <>{selected.every((take) => take.disabled) ? `enable ${label}` : `disable ${label} (skipped by keeper fallback)`}</>, onClick: () => updateSelected({ disabled: !selected.every((take) => take.disabled) }) },
            ...TAKE_COLORS.map(
              (c) =>
                ({
                  label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{t.color === c ? 'color ✓' : `color${batch ? ` ${ids.length}` : ''}`}</span>,
                  onClick: () => updateSelected({ color: t.color === c && !batch ? null : c })
                }) as MenuEntry
            )
          ]
          return <ContextMenu x={takeMenu.x} y={takeMenu.y} entries={entries} onClose={() => setTakeMenu(null)} />
        })()}
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
