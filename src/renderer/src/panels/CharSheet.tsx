import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { MIME_IMAGE, MIME_VOICE } from '../lib/dragDrop'
import { ctl } from '../ui/controls'
import { focusAudio } from '../audioBus'
import { openVoicesCard } from '../panelBus'
import { toast } from '../ui/Toast'
import { Ic, Play, Pause } from '../ui/icons'

// ---- the sheet's VOICE group: the character's voice lives with the character. 🎤 opens (or
// creates) the character's voice in the Voices card; the bound voice's ★ keeper rides into
// every linking clip as an @audio ref, its description into the YAML. ----
function SheetVoiceGroup({ sheet }: { sheet: CharSheet }): React.JSX.Element {
  const voiceClips = useStore((s) => s.project?.voiceClips)
  const saveCharSheet = useStore((s) => s.saveCharSheet)
  const saveVoiceClip = useStore((s) => s.saveVoiceClip)
  const createVoiceClip = useStore((s) => s.createVoiceClip)
  const setEditorVoice = useStore((s) => s.setEditorVoice)
  const voice = sheet.voiceId ? voiceClips?.find((v) => v.id === sheet.voiceId) : undefined
  const keeper = voice ? voice.takes.find((t) => t.id === voice.keeperTakeId) ?? voice.takes[voice.takes.length - 1] : undefined
  const [over, setOver] = useState(false)
  const [pick, setPick] = useState(false)
  const [busy, setBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  // the character's voice: the bound one, made on demand — named after the character, the
  // sheet's image riding along as the voice's image
  const ensureVoice = async (): Promise<string | null> => {
    if (voice) return voice.id
    const id = await createVoiceClip(`${sheet.name} voice`)
    if (!id) return null
    const fresh = useStore.getState().project?.voiceClips.find((v) => v.id === id)
    if (fresh && sheet.imageId) await saveVoiceClip(id, { recipe: { ...fresh.recipe, imageId: sheet.imageId } })
    await saveCharSheet(sheet.id, { voiceId: id })
    return id
  }
  const openDesign = async (): Promise<void> => {
    const id = await ensureVoice()
    if (!id) return
    setEditorVoice(id)
    openVoicesCard()
  }
  const describe = async (): Promise<void> => {
    setBusy(true)
    try {
      const id = await ensureVoice()
      if (!id) return
      setEditorVoice(id)
      openVoicesCard()
      const r = await window.vidancer.voiceDescribe(sheet.id)
      if (!r.ok || !r.desc) {
        toast(r.error ?? 'describe failed', { kind: 'error' })
        return
      }
      const fresh = useStore.getState().project?.voiceClips.find((v) => v.id === id)
      if (fresh) await saveVoiceClip(id, { recipe: { ...fresh.recipe, desc: r.desc } })
      toast('voice described — review it in the Voices card, then Generate', { kind: 'ok' })
    } finally {
      setBusy(false)
    }
  }
  return (
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
      style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', marginBottom: 10, outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: 2 }}
    >
      <audio ref={audioRef} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} style={{ display: 'none' }} />
      <div style={{ ...lb, marginBottom: 5 }}>voice — the ★ keeper rides into every clip this sheet links (an @audio ref + the description in the YAML)</div>
      {!voice ? (
        <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="btn vd-hbtn" title="make this character's voice — opens the Voices card on it" onClick={() => void openDesign()}>
            🎤 design a voice
          </span>
          <span
            className="btn vd-hbtn"
            style={busy ? { opacity: 0.5, cursor: 'default' } : undefined}
            title="one sub-call writes a voice description from this sheet's fields — it lands on the voice, you press Generate"
            onClick={() => !busy && void describe()}
          >
            {busy ? '⏳ describing…' : '✎ describe voice'}
          </span>
          <span className="btn vd-hbtn" title="bind an existing 🎤 voice from the Bin" onClick={() => setPick((p) => !p)}>
            bind existing… ▾
          </span>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>— or drag a 🎤 voice here</span>
          {pick && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 220, maxHeight: 220, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
              {(voiceClips ?? []).length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no voices yet — 🎤 design one</div>}
              {(voiceClips ?? []).map((v) => (
                <div
                  key={v.id}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void saveCharSheet(sheet.id, { voiceId: v.id })
                    setPick(false)
                  }}
                  style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}
                >
                  🎤 {v.name}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            className="btn vd-hbtn"
            style={{ padding: '2px 7px', ...(keeper ? {} : { opacity: 0.5, cursor: 'default' }) }}
            title={keeper ? 'play the ★ keeper take' : 'no take yet — 🎤 open the voice and Generate one'}
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
            <Ic i={playing ? Pause : Play} size={11} />
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            🎤 {voice.name}
            {keeper?.durationSec ? ` · ${Math.round(keeper.durationSec * 10) / 10}s` : keeper ? '' : ' · no take yet'}
          </span>
          <span className="btn vd-hbtn" title="open this voice in the Voices card (takes · description · re-renders)" onClick={() => void openDesign()}>
            🎤 open
          </span>
          <span style={{ cursor: 'pointer', color: 'var(--dim)' }} title="unbind the voice (it stays in the Bin)" onClick={() => void saveCharSheet(sheet.id, { voiceId: null })}>
            ✕
          </span>
        </div>
      )}
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
      <EmptyState>double-click a ⛉ char sheet in the Bin — or create one there — to edit it here</EmptyState>
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
            onClick={() => setImgPick((v) => !v)}
            title="the character's image — click to pick from the Library, or drag an image here"
            style={{ width: 148, height: 148, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--line2)' }}
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
            <div style={{ fontSize: 9.5, color: 'var(--gold)', fontFamily: 'var(--mono)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, maxWidth: 148 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.title}</span>
              <span style={{ cursor: 'pointer', color: 'var(--dim)' }} title="unlink the image" onClick={() => push({ ...draft, imageId: undefined })}>
                ✕
              </span>
            </div>
          )}
          {imgPick && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 220, maxHeight: 240, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
              {images.length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no Library images yet</div>}
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
      <SheetVoiceGroup sheet={sheet} />
      {area('base', 'base')}
      {area('features', 'features')}
      {area('physics', 'physics')}
      {area('movement_in_this_scene (optional)', 'movement', 'restrictions/shape of movement')}
      {area('emotional_state (optional)', 'emotionalState', 'tone carried through')}
      {area('state_in_this_scene (optional)', 'stateInThisScene', 'starting state — wounds, posture, activity')}
      {area('power_this_scene (optional)', 'power', 'mechanical behavior of an ability')}
    </div>
  )
}
