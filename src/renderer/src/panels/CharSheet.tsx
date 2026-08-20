import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { useWave, peakAmp } from '../lib/waveform'
import { openLibraryPanel } from '../panelBus'
import { MIME_IMAGE, MIME_VOICE } from '../lib/dragDrop'
import { ctl } from '../ui/controls'
import { focusAudio } from '../audioBus'
import { Ic, Play, Pause } from '../ui/icons'

// ---- decorative keeper-take waveform filling the gap right of the voice box (user brief
// 2026-08-20): border-colored, fades out toward the card's right edge, never interactive.
// Draw loop = the timeline block-wave sibling (Timeline.tsx) — bitmap from clientRect,
// ResizeObserver redraw, center-mirrored 1px bars, peakAmp dB mapping. ----
function VoiceWaveGap({ file, audioEl, playing }: { file: string; audioEl: React.RefObject<HTMLAudioElement | null>; playing: boolean }): React.JSX.Element {
  const wave = useWave(file, true)
  const ref = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !wave) return
    const draw = (): void => {
      const r = c.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return
      c.width = Math.round(r.width)
      c.height = Math.round(r.height)
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, c.width, c.height)
      // canvas can't resolve CSS vars — read the border grey at draw time so it re-themes
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--line2').trim() || '#3a3a3a'
      const mid = c.height / 2
      for (let x = 0; x < c.width; x++) {
        const t = (x / c.width) * wave.dur
        const p = wave.peaks[Math.min(wave.peaks.length - 1, Math.max(0, Math.floor(t * wave.pps)))] ?? 0
        const half = Math.max(0.7, (peakAmp(p) * (c.height - 2)) / 2)
        const u = Math.min(1, Math.max(0, (x / c.width - 0.55) / 0.45)) // fade past 55% width
        ctx.globalAlpha = 1 - u * u * (3 - 2 * u)
        ctx.fillRect(x, mid - half, 1, half * 2)
      }
      ctx.globalAlpha = 1
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [wave])
  // playhead sweep while the ▶ chip plays — imperative transform on a rAF, no re-renders
  // (the house playhead pattern); rough sync is fine, this is a visual effect only
  useEffect(() => {
    const trail = trailRef.current
    if (!trail) return
    if (!playing) {
      trail.style.opacity = '0'
      return
    }
    let raf = 0
    const tick = (): void => {
      const el = audioEl.current
      const w = wrapRef.current?.clientWidth ?? 0
      const dur = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : wave?.dur ?? 0
      if (el && w > 0 && dur > 0) {
        trail.style.transform = `translateX(${Math.min(1, el.currentTime / dur) * w}px)`
        trail.style.opacity = '1'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      trail.style.opacity = '0'
    }
  }, [playing, wave, audioEl])
  return (
    <div ref={wrapRef} aria-hidden style={{ position: 'relative', flex: 1, minWidth: 0, height: 148, pointerEvents: 'none', overflow: 'hidden' }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div
        ref={trailRef}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: -38,
          width: 38,
          opacity: 0,
          background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--txt-hi) 40%, transparent) 82%, var(--txt-hi))',
          transition: 'opacity .18s'
        }}
      />
    </div>
  )
}

// ---- the sheet's VOICE field: a drag-only file slot (user law 2026-08-20: NO pick list —
// the voice is dragged from the Bin's 🎤 section; ✕ unlinks). Wears the voice's image face;
// the ★ keeper take's waveform fills the gap to the right. Nothing autofills. ----
function SheetVoiceField({ sheet }: { sheet: CharSheet }): React.JSX.Element {
  const voiceClips = useStore((s) => s.project?.voiceClips)
  const images = useStore((s) => s.project?.images)
  const saveCharSheet = useStore((s) => s.saveCharSheet)
  const voice = sheet.voiceId ? voiceClips?.find((v) => v.id === sheet.voiceId) : undefined
  const keeper = voice ? voice.takes.find((t) => t.id === voice.keeperTakeId && !t.disabled) ?? [...voice.takes].reverse().find((t) => !t.disabled) : undefined
  const vim = voice?.recipe.imageId ? images?.find((i) => i.id === voice.recipe.imageId) : undefined
  const [over, setOver] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={lb}>voice</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes(MIME_VOICE)) {
            e.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(MIME_VOICE)
          setOver(false)
          if (!id) return
          e.preventDefault()
          void saveCharSheet(sheet.id, { voiceId: id })
        }}
        style={{ position: 'relative', display: 'inline-block', flex: '0 0 auto', borderRadius: 6, outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: 2 }}
      >
        <audio ref={audioRef} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} style={{ display: 'none' }} />
        <div
          title={voice ? "the character's voice — drag another 🎤 voice from the Bin to swap it" : "the character's voice — drag a 🎤 voice here from the Bin's voices"}
          style={{ width: 148, height: 148, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line2)', gap: 2 }}
        >
          {voice && vim ? (
            <img src={mediaUrl(vim.file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : voice ? (
            <>
              <span style={{ fontSize: 18 }}>🎤</span>
              <span style={{ fontSize: 10, color: 'var(--txt-hi)', maxWidth: 136, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{voice.name}</span>
            </>
          ) : (
            <span style={{ color: 'var(--dim)', fontSize: 10, textAlign: 'center', padding: 6 }}>
              drag a 🎤 voice here
              <br />
              from the Bin&apos;s voices
            </span>
          )}
        </div>
        {voice && (
          <div style={{ fontSize: 9.5, color: 'var(--gold)', fontFamily: 'var(--mono)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, maxWidth: 148 }}>
            <span
              className="btn vd-hbtn"
              style={{ padding: '1px 6px', flex: '0 0 auto', ...(keeper ? {} : { opacity: 0.5, cursor: 'default' }) }}
              title={keeper ? 'play the ★ keeper take' : 'no take yet — this voice has nothing rendered'}
              onClick={() => {
                const el = audioRef.current
                if (!el || !keeper) return
                if (playing && !el.paused) {
                  el.pause()
                  return
                }
                el.src = mediaUrl(keeper.file)
                el.muted = false
                focusAudio(el)
                void el.play()
                setPlaying(true)
              }}
            >
              <Ic i={playing ? Pause : Play} size={10} />
            </span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{voice.name}</span>
            <span style={{ cursor: 'pointer', color: 'var(--dim)' }} title="unlink the voice" onClick={() => void saveCharSheet(sheet.id, { voiceId: null })}>
              ✕
            </span>
          </div>
        )}
      </div>
      {keeper && <VoiceWaveGap file={keeper.file} audioEl={audioRef} playing={playing} />}
      </div>
    </div>
  )
}

// STABLE empty fallback — `?? []` inside a store selector mints a fresh array per snapshot read
// while project is null, which loops React's store sync to "maximum update depth"
const NO_IMAGES: ProjImage[] = []

const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }

// ---- Char Sheet: a character's single home (image + universal description) as a DOCKED editor
// panel — same UX grammar as Clip Gen / the Video Editor: authoring surfaces are panels, never popups.
// Double-click a ⛉ tile in the Bin to load it here; edits debounce-save and flush on switch/close.
export function CharSheetPanel(): React.JSX.Element {
  const editorSheetId = useStore((s) => s.editorSheetId)
  const sheet = useStore((s) => (s.editorSheetId ? s.project?.charSheets.find((x) => x.id === s.editorSheetId) : undefined))
  const images = useStore((s) => s.project?.images ?? NO_IMAGES)
  const saveCharSheet = useStore((s) => s.saveCharSheet)
  const [draft, setDraft] = useState<CharSheet | null>(null)
  const [imgPick, setImgPick] = useState(false)
  const [imgOver, setImgOver] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const pendingRef = useRef<CharSheet | null>(null)
  const flush = (): void => {
    window.clearTimeout(timer.current)
    const pend = pendingRef.current
    pendingRef.current = null
    if (pend) void useStore.getState().saveCharSheet(pend.id, { name: pend.name, imageId: pend.imageId ?? null, character: pend.character })
  }
  // target switched → commit any pending edit to the PREVIOUS sheet, then load the new one
  useEffect(() => {
    flush()
    setDraft(sheet ? (JSON.parse(JSON.stringify(sheet)) as CharSheet) : null)
    setImgPick(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSheetId])
  // adopt EXTERNAL changes (undo/redo, deletion) while open — but never over an in-flight local edit
  useEffect(() => {
    if (!sheet) {
      if (editorSheetId) setDraft(null)
      return
    }
    if (pendingRef.current) return // our edit is the newest intent
    setDraft((d) => (d && JSON.stringify(d) === JSON.stringify(sheet) ? d : (JSON.parse(JSON.stringify(sheet)) as CharSheet)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet])
  // flush on unmount so a just-typed edit isn't lost when the panel closes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), [])

  if (!sheet || !draft) {
    return (
      <EmptyState>
        no character open — double-click a ⛉ char sheet in the Bin to edit it here
        <br />
        <span
          className="btn vd-hbtn"
          style={{ marginTop: 8, display: 'inline-block' }}
          onClick={() =>
            void useStore
              .getState()
              .createCharSheet()
              .then((id) => id && useStore.getState().setEditorSheet(id))
          }
        >
          ＋ new char sheet
        </span>
      </EmptyState>
    )
  }

  const push = (next: CharSheet): void => {
    setDraft(next)
    pendingRef.current = next
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      pendingRef.current = null
      void saveCharSheet(next.id, { name: next.name, imageId: next.imageId ?? null, character: next.character })
    }, 500)
  }
  const upd = (patch: Partial<CharacterField>): void => push({ ...draft, character: { ...draft.character, ...patch } })
  const im = draft.imageId ? images.find((i) => i.id === draft.imageId) : undefined
  const area = (label: string, key: keyof CharacterField, ph?: string): React.JSX.Element => (
    <div style={{ marginBottom: 6 }}>
      <div style={lb}>{label}</div>
      <textarea
        value={(draft.character[key] as string) ?? ''}
        onChange={(e) => upd({ [key]: e.target.value } as Partial<CharacterField>)}
        placeholder={ph}
        rows={2}
        style={{ ...ctl, width: '100%', resize: 'vertical' }}
      />
    </div>
  )

  return (
    <div className="vd-panel vd-scroll" style={{ height: '100%' }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', marginBottom: 8 }}>
        ⛉ char sheet <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>— the character's single home; clips link it live from the characters "from clip" picker</span>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* the character's image — drives the Bin tile AND the linked @ref in every clip (by id, rename-proof) */}
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
            const hit = images.find((i) => i.file === f)
            if (hit) push({ ...draft, imageId: hit.id })
          }}
          style={{ position: 'relative', flex: '0 0 auto', borderRadius: 6, outline: imgOver ? '2px dashed var(--amber)' : 'none', outlineOffset: 2 }}
        >
          <div
            onClick={() => (images.length ? setImgPick((v) => !v) : openLibraryPanel())}
            title={images.length ? "the character's image — click to pick from the Library, or drag an image here" : 'no Library images yet — click opens the Library'}
            style={{ width: 148, height: 148, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--line2)' }}
          >
            {im ? (
              <img src={mediaUrl(im.file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : images.length ? (
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
            <div style={{ fontSize: 9.5, color: 'var(--gold)', fontFamily: 'var(--mono)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, maxWidth: 148 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.title}</span>
              <span style={{ cursor: 'pointer', color: 'var(--dim)' }} title="unlink the image" onClick={() => push({ ...draft, imageId: undefined })}>
                ✕
              </span>
            </div>
          )}
          {imgPick && images.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 220, maxHeight: 240, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
              {images.map((x) => (
                <div
                  key={x.id}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    push({ ...draft, imageId: x.id })
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
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={lb}>sheet name</div>
          <input value={draft.name} onChange={(e) => push({ ...draft, name: e.target.value })} placeholder="sheet name" style={{ ...ctl, width: '100%', marginBottom: 8 }} />
          <div style={lb}>character name (snake_case)</div>
          <input value={draft.character.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. barbarian" style={{ ...ctl, width: '100%' }} />
        </div>
      </div>
      {area('base', 'base')}
      {area('features', 'features')}
      {area('physics', 'physics')}
      <SheetVoiceField sheet={sheet} />
      {area('voice description', 'voice', 'how the character sounds — added to the prompt')}
      {area('movement_in_this_scene (optional)', 'movement', 'restrictions/shape of movement')}
      {area('emotional_state (optional)', 'emotionalState', 'tone carried through')}
      {area('state_in_this_scene (optional)', 'stateInThisScene', 'starting state — wounds, posture, activity')}
      {area('power_this_scene (optional)', 'power', 'mechanical behavior of an ability')}
    </div>
  )
}
