import { EmptyState } from '../ui/EmptyState'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { ClipFields, useFieldFocus, fieldChrome } from './ClipFields'
import { Beats, fitArr } from './Beats'
import { Thumbnail } from '../Thumbnail'
import { mediaUrl } from '../media'
import { focusAudio, muteAll, subAudio } from '../audioBus'
import { buildYaml, buildNatural, buildProse, buildCombinedFor, applyRefTags, lintFields, EMPTY_SCENE, EMPTY_PRODUCTION, beatRefFile, beatRanges, BEAT_COLORS } from '../emitYaml'
import { smpte } from '../lib/time'
import { MODELS, modelFor, DEFAULT_ENGINE } from '../../../shared/models'
import { validateForm } from '../lib/validation'
import { MIME_IMAGE, MIME_TAKE, MIME_VIDEO, MIME_AUDIO } from '../lib/dragDrop'
import { activeItems } from '../lib/timelineUtils'
import { ctl } from '../ui/controls'
import { toast } from '../ui/Toast'
import { openProjectStyles, openVideoEditor, openClipMonitor, openLibraryPanel, setClipGenPlayToggle, setClipGenMarkInOut } from '../panelBus'
import { Ic, Link2, ImageDown, Play, Pause, Volume2, VolumeX, Maximize2, Wand2, FolderInput, ChevronUp, ChevronDown } from '../ui/icons'
import { ContextMenu } from '../ui/ContextMenu'
import { ResizeHandle } from '../ui/ResizeHandle'
import { modelWizard } from '../lib/modelWizard'

// take-card highlight palette (right-click a take card) — fixed set so colors stay meaningful
const TAKE_COLORS = ['#e05656', '#e09b3d', '#d8c93a', '#4fae5c', '#3d8fd6', '#9b6ad6']

// keep the stored value selectable even when the active engine doesn't list it — the value is
// preserved (store-everything), validation flags it, and switching engines back restores validity
const withCurrent = (options: string[], current: string): string[] =>
  options.includes(current) ? options : [current, ...options]

// the "generated from fields" preview with a Ctrl+F find (docs/YAML-FIND-SPEC-2026-08-26.md):
// Ctrl+F while the mouse is over the box (or after clicking into it) opens a bar top-right —
// query · n/N · prev · next · ✕. Enter = next, Shift+Enter = prev, Esc = close; matches wrap.
// Case-insensitive plain text; all hits dim amber, the current one solid + scrolled into view.
function YamlPreview({ text }: { text: string }): React.JSX.Element {
  const [find, setFind] = useState<{ q: string; idx: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const curRef = useRef<HTMLElement | null>(null)
  const hoverRef = useRef(false)
  const lastQ = useRef('') // the query survives close → reopen restores the last search
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.repeat) return
      if (!hoverRef.current && !wrapRef.current?.contains(document.activeElement)) return
      e.preventDefault()
      setFind((f) => f ?? { q: lastQ.current, idx: 0 })
      requestAnimationFrame(() => inputRef.current?.select())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const q = find?.q ?? ''
  const matches = useMemo(() => {
    if (!q) return []
    const out: number[] = []
    const hay = text.toLowerCase()
    const needle = q.toLowerCase()
    for (let i = hay.indexOf(needle); i !== -1 && out.length < 999; i = hay.indexOf(needle, i + needle.length)) out.push(i)
    return out
  }, [text, q])
  // idx free-runs; the modulo keeps prev/next wrapping even as edits change the match count
  const cur = matches.length ? ((((find?.idx ?? 0) % matches.length) + matches.length) % matches.length) : 0
  const step = (d: number): void => setFind((f) => (f ? { ...f, idx: (matches.length ? cur : 0) + d } : f))
  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'nearest' })
  }, [cur, q, matches.length])
  const content = useMemo(() => {
    if (!find || !matches.length) return text
    const parts: React.ReactNode[] = []
    let last = 0
    matches.forEach((m, i) => {
      if (m > last) parts.push(text.slice(last, m))
      parts.push(
        <mark
          key={m}
          ref={i === cur ? (el): void => void (curRef.current = el) : undefined}
          style={{ background: i === cur ? 'var(--amber)' : 'color-mix(in srgb, var(--amber) 30%, transparent)', color: i === cur ? '#000' : 'inherit', borderRadius: 2 }}
        >
          {text.slice(m, m + q.length)}
        </mark>
      )
      last = m + q.length
    })
    parts.push(text.slice(last))
    return parts
  }, [find, text, q, matches, cur])
  return (
    <div ref={wrapRef} onMouseEnter={() => (hoverRef.current = true)} onMouseLeave={() => (hoverRef.current = false)} style={{ position: 'relative' }}>
      {find && (
        <div style={{ position: 'absolute', top: 4, right: 12, zIndex: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, padding: '2px 4px' }}>
          <input
            ref={inputRef}
            autoFocus
            value={find.q}
            onChange={(e) => {
              lastQ.current = e.target.value
              setFind({ q: e.target.value, idx: 0 })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
              if (e.key === 'Escape') setFind(null)
            }}
            placeholder="find…"
            style={{ ...ctl, width: 130 }}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', minWidth: 30, textAlign: 'center' }}>{matches.length ? `${cur + 1}/${matches.length}` : '0/0'}</span>
          <span className="btn vd-hbtn" title="previous match (Shift+Enter)" onClick={() => step(-1)}>
            <Ic i={ChevronUp} size={11} />
          </span>
          <span className="btn vd-hbtn" title="next match (Enter)" onClick={() => step(1)}>
            <Ic i={ChevronDown} size={11} />
          </span>
          <span title="close (Esc)" style={{ cursor: 'pointer', color: 'var(--dim)', padding: '0 3px' }} onClick={() => setFind(null)}>
            ✕
          </span>
        </div>
      )}
      <pre className="vd-copy" tabIndex={0} style={{ ...ctl, width: '100%', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', color: 'color-mix(in srgb, var(--ok) 55%, var(--txt-hi))', margin: 0 }}>
        {content}
      </pre>
    </div>
  )
}

export function RenderPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const renameClip = useStore((s) => s.renameClip)
  const importToLibrary = useStore((s) => s.importToLibrary)
  const setKeeper = useStore((s) => s.setKeeper)
  const editTimelineIndex = useStore((s) => s.editTimelineIndex)
  const createClip = useStore((s) => s.createClip)
  const saveClipPromptData = useStore((s) => s.saveClipPromptData)
  const autoTime = useStore((s) => s.autoTime)
  const renameSignal = useStore((s) => s.renameSignal)
  const fileSwap = useStore((s) => s.fileSwap)
  const undoTick = useStore((s) => s.undoTick)

  const [clipName, setClipName] = useState('')
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE)
  // local-engine readiness (the ScoreCard shape): a DISTILLED LTX size on disk = renderable;
  // full (dev bf16) alone is not — its sampling recipe is unprobed (LTX-SPEC §9.1)
  const [ltxSt, setLtxSt] = useState<{ renderReady: boolean; fullOnly: boolean }>({ renderReady: false, fullOnly: false })
  useEffect(() => {
    const load = (): void => {
      void window.vidancer.modelsList().then((l) => {
        const ready = (id: string): boolean => l.rows.find((x) => x.id === id)?.status === 'ready'
        const distilled = ['ltx-2.5-quality', 'ltx-2.5-standard', 'ltx-2.5-compact', 'ltx-2.5-small', 'ltx-2.5-minimum'].some(ready)
        setLtxSt({ renderReady: distilled, fullOnly: !distilled && ready('ltx-2.5-full') })
      })
    }
    load()
    return window.vidancer.onModelsDone(load)
  }, [])
  const [mode, setMode] = useState<'ref2v' | 'i2v'>('ref2v')
  const [freeform, setFreeform] = useState('')
  const [scene, setScene] = useState<SceneFields>({ ...EMPTY_SCENE })
  const [characters, setCharacters] = useState<CharacterField[]>([])
  const [beats, setBeats] = useState<BeatField[]>([])
  const [production, setProduction] = useState<ProductionFields>({ ...EMPTY_PRODUCTION })
  const [expanded, setExpanded] = useState(false)
  const [refImages, setRefImages] = useState<string[]>([])
  const [videoRefs, setVideoRefs] = useState<VideoRef[]>([]) // Seedance @video slots (positional)
  const [audioRefs, setAudioRefs] = useState<AudioRef[]>([]) // Seedance @audio slots (positional)
  const [startFile, setStartFile] = useState('')
  const [endFile, setEndFile] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [aspect, setAspect] = useState('auto')
  const [audio, setAudio] = useState(true)
  const [status, setStatus] = useState('idle')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const loadingRef = useRef(false) // true while populating the form from a clip → suppress auto-save
  const beatsDirtyRef = useRef(false) // true when beats were edited HERE since load → only then persist them
  const lastSavedBeatsRef = useRef<string | null>(null) // JSON of the beats THIS panel last loaded/saved — detects EXTERNAL writers
  const adoptRef = useRef(false) // '+ new' adopted typed content → the next load KEEPS the form (no wipe)
  const projDirRef = useRef<string | undefined>(undefined) // which project the form's content belongs to
  const lastRenameN = useRef(0) // last rename-signal seen (rewrite our LIVE text once per rename)
  const lastSwapN = useRef(0) // last file-swap signal seen (primary version change → repoint live refs)
  const [pvMuted, setPvMuted] = useState(true) // take preview is muted by default
  const [pvPlaying, setPvPlaying] = useState(true)
  const [pvDur, setPvDur] = useState(0) // previewed take's real video length (metadata)
  const [pvIn, setPvIn] = useState(0) // preview in/out window — what a DRAG places on the timeline
  const [pvOut, setPvOut] = useState<number | null>(null) // null = full take
  const jogBarRef = useRef<HTMLDivElement>(null) // take-preview jogger — Clip Monitor grammar, seek-only
  const jogPhRef = useRef<HTMLDivElement>(null)
  const jogTcRef = useRef<HTMLSpanElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const pendingFocusRef = useRef(false) // double-clicked a link chip → focus the prompt once the target loads
  const [preview, setPreview] = useState<string | null>(null)
  const [picker, setPicker] = useState<'ref' | 'start' | 'end' | null>(null)
  const [vidPicker, setVidPicker] = useState(false) // "+ add" popover for @video slots
  const [audPicker, setAudPicker] = useState(false) // "+ add" popover for @audio slots
  const [trimSlot, setTrimSlot] = useState<{ kind: 'v' | 'a'; i: number } | null>(null) // ✂ window editor open on this slot
  const trimInRef = useRef<HTMLInputElement>(null)
  const trimOutRef = useRef<HTMLInputElement>(null)
  const [dragTarget, setDragTarget] = useState<'ref' | 'start' | 'end' | null>(null)
  const [takeDrop, setTakeDrop] = useState<string | null>(null) // field a dragged T-chip is hovering
  const [closedSecs, setClosedSecs] = useState<Set<string>>(new Set()) // collapsed section landmarks
  const [promptLink, setPromptLink] = useState<{ clipId: string; pos: 'before' | 'after' } | null>(null)
  const [linkPicker, setLinkPicker] = useState(false) // the "link a clip's prompt" chooser is open
  const [takeCtx, setTakeCtx] = useState<{ x: number; y: number; takeId: string; label: string } | null>(null) // T-chip right-click → edit that take (v2v)
  const previewH = useStore((s) => s.previewH.render)
  const setPreviewH = useStore((s) => s.setPreviewH)
  const pvBoxRef = useRef<HTMLDivElement>(null) // the black preview box — resize clamps against its scroll parent
  // Co-Director provenance: which paths the AI last wrote (tinted); a manual edit clears its path
  const [enhancedPaths, setEnhancedPaths] = useState<string[]>([])
  const clearEnhanced = (path: string): void => setEnhancedPaths((a) => (a.includes(path) ? a.filter((p) => p !== path) : a))
  const fieldMeta = selectedClipId
    ? { owner: { kind: 'clip' as const, id: selectedClipId }, enhanced: enhancedPaths, onUserEdit: clearEnhanced }
    : undefined
  const freeformFocus = useFieldFocus(fieldMeta, 'freeform')
  const [fieldLinks, setFieldLinks] = useState<Record<string, string[]>>({}) // field path → ordered stack of source ids (styles/clips)
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, string[]>>({}) // path → source ids the FIELD replaces (pushed via double-click; faded chips)
  const [charLinks, setCharLinks] = useState<CharacterLink[]>([]) // LIVE-linked characters from other clips

  const isI2v = mode === 'i2v'
  const model = modelFor(engine) // the active engine's capability descriptor drives the fields below
  const libImages = project?.images ?? []
  const titleOf = (file: string): string | undefined => libImages.find((i) => i.file === file)?.title
  const fileOfTitle = (title: string): string | undefined => libImages.find((i) => i.title === title)?.file
  const libVideos = project?.videos ?? []
  const libAudio = project?.audio ?? []
  // resolve a @video slot's source: display name, playable file (thumb/scrub) and natural length
  const vrefInfo = (r: VideoRef): { file?: string; name: string; natSec?: number } => {
    if (r.videoId) {
      const v = libVideos.find((x) => x.id === r.videoId)
      return { file: v?.file, name: v?.title ?? '(deleted video)', natSec: v?.durationSec }
    }
    const c = project?.clips.find((x) => x.id === r.takeRef?.clipId)
    const t = c?.takes.find((x) => x.id === r.takeRef?.takeId)
    const tn = c && t ? c.takes.findIndex((x) => x.id === t.id) + 1 : 0
    return { file: t?.file, name: c && t ? `${c.name} · T${tn}` : '(deleted take)', natSec: t?.durationSec }
  }
  // a slot's SENT length: the ✂ window when set, else the source's natural length (may be unknown)
  const vrefSec = (r: VideoRef): number | undefined =>
    r.inSec != null && r.outSec != null && r.outSec > r.inSec ? r.outSec - r.inSec : vrefInfo(r).natSec
  const arefSec = (r: AudioRef): number | undefined =>
    r.inSec != null && r.outSec != null && r.outSec > r.inSec ? r.outSec - r.inSec : libAudio.find((a) => a.id === r.audioId)?.durationSec

  // a clip can live-embed ONE other clip's prompt: the linked clip's CURRENT freeform is spliced
  // before/after our own at render. Resolved by id → renames are safe, a deleted clip just drops out.
  const linkedClip = promptLink ? project?.clips.find((c) => c.id === promptLink.clipId) : undefined
  const linkedText = (linkedClip?.promptData.freeform ?? '').trim()
  const effectiveFreeform =
    promptLink && linkedText
      ? promptLink.pos === 'before'
        ? `${linkedText}\n${freeform}`.trim()
        : `${freeform}\n${linkedText}`.trim()
      : freeform
  // per-field links: a field can borrow a STACK of sources' SAME field (project styles and/or other
  // clips, in stack order), then your own text is appended. Dangling ids resolve to nothing.
  const projStyles = project?.styles ?? []
  const readField = (src: { scene?: SceneFields; production?: ProductionFields }, path: string): string => {
    const [g, k] = path.split('.')
    const grp = g === 'scene' ? src.scene : g === 'production' ? src.production : undefined
    return grp ? (grp as unknown as Record<string, string>)[k] ?? '' : ''
  }
  // a source id is a project style or a clip — both carry the same scene/production groups
  const readSource = (id: string, path: string): string => {
    const st = projStyles.find((s) => s.id === id)
    if (st) return readField(st, path)
    const c = project?.clips.find((x) => x.id === id)
    return c ? readField(c.promptData, path) : ''
  }
  const splice = (linkedVals: string[], mine: string): string => [...linkedVals, mine].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
  // an OVERRIDDEN source (faded chip) is skipped — the field's own text replaces it in the splice
  const liveStack = (path: string): string[] => (fieldLinks[path] ?? []).filter((id) => !(fieldOverrides[path] ?? []).includes(id))
  const resolveScene = (s: SceneFields): SceneFields => {
    const out: SceneFields = { ...s }
    for (const k of Object.keys(s) as (keyof SceneFields)[]) {
      const vals = liveStack(`scene.${k}`).map((id) => readSource(id, `scene.${k}`)).filter((v) => v.trim())
      if (vals.length) out[k] = splice(vals, s[k] ?? '')
    }
    return out
  }
  const resolveProduction = (p: ProductionFields): ProductionFields => {
    const out: ProductionFields = { ...p }
    for (const k of Object.keys(p) as (keyof ProductionFields)[]) {
      const vals = liveStack(`production.${k}`).map((id) => readSource(id, `production.${k}`)).filter((v) => v.trim())
      if (vals.length) out[k] = splice(vals, p[k] ?? '')
    }
    return out
  }
  // LIVE-linked characters: each link resolves to the source clip's CURRENT character block
  // (matched by name); per-field override text appends AFTER the source's value (same splice rule
  // as fieldLinks; an override @ref REPLACES the source's). Dangling links → nothing.
  const resolveCharLink = (l: CharacterLink): CharacterField | undefined => {
    // char sheets first (l.clipId may be a sheet id): the sheet's CURRENT fields, with the @ref
    // resolved LIVE from its image by id — rename-proof
    const sheet = project?.charSheets?.find((s) => s.id === l.clipId)
    if (sheet) {
      const title = sheet.imageId ? project?.images.find((i) => i.id === sheet.imageId)?.title ?? '' : ''
      return { ...sheet.character, name: sheet.character.name || sheet.name, referenceLabel: title || sheet.character.referenceLabel }
    }
    return project?.clips.find((c) => c.id === l.clipId)?.promptData.characters.find((ch) => ch.name === l.charName)
  }
  const spliceChar = (src: CharacterField, o?: Partial<CharacterField>, replaced?: CharLinkTextKey[]): CharacterField => {
    // a replaced key ignores the source entirely — the override text IS the field (may be blank)
    const j = (k: CharLinkTextKey, a?: string, b?: string): string =>
      replaced?.includes(k) ? (b ?? '').trim() : [a, b].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
    const app = (a?: string, b?: string): string => [a, b].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
    const opt = (v: string): string | undefined => v || undefined
    return {
      name: src.name,
      referenceLabel: (o?.referenceLabel ?? '').trim() || src.referenceLabel,
      base: j('base', src.base, o?.base),
      features: j('features', src.features, o?.features),
      physics: j('physics', src.physics, o?.physics),
      voice: opt(app(src.voice ?? '', o?.voice)),
      movement: opt(j('movement', src.movement, o?.movement)),
      emotionalState: opt(j('emotionalState', src.emotionalState, o?.emotionalState)),
      stateInThisScene: opt(j('stateInThisScene', src.stateInThisScene, o?.stateInThisScene)),
      power: opt(j('power', src.power, o?.power))
    }
  }
  const resolvedLinkChars = charLinks
    .map((l) => {
      const src = resolveCharLink(l)
      return src ? spliceChar(src, l.override, l.replaced) : undefined
    })
    .filter((ch): ch is CharacterField => !!ch)
  const structured = { scene, characters, beats, production, duration } // local (what you typed) — drives lint
  const effectiveStructured = { scene: resolveScene(scene), characters: [...resolvedLinkChars, ...characters], beats, production: resolveProduction(production), duration }
  // emit in the ACTIVE engine's flavor — lint, mention warnings and the preview must all judge the
  // prompt that will actually be sent, not a Seedance YAML the model never sees
  const promptStyle = modelFor(engine).promptStyle ?? 'yaml'
  const yamlPreview = promptStyle === 'prose' ? buildProse(effectiveStructured) : promptStyle === 'natural' ? buildNatural(effectiveStructured) : buildYaml(effectiveStructured)
  const combined = buildCombinedFor(promptStyle, effectiveFreeform, effectiveStructured)
  const dropOverride = (path: string, id: string): void =>
    setFieldOverrides((m) => {
      const rest = (m[path] ?? []).filter((x) => x !== id)
      const n = { ...m }
      if (rest.length) n[path] = rest
      else delete n[path]
      return n
    })
  // the bundle the fields use to pick/show/open per-field links — project styles pinned above clips
  const fieldLinking = {
    links: fieldLinks,
    srcName: (id: string): string => projStyles.find((s) => s.id === id)?.name ?? project?.clips.find((c) => c.id === id)?.name ?? '(removed)',
    srcKind: (id: string): 'style' | 'clip' => (projStyles.some((s) => s.id === id) ? 'style' : 'clip'),
    preview: (id: string, path: string): string => readSource(id, path),
    pickList: [
      ...projStyles.map((s) => ({ id: s.id, name: s.name, kind: 'style' as const })),
      ...(project?.clips ?? []).filter((c) => c.id !== selectedClipId).map((c) => ({ id: c.id, name: c.name, kind: 'clip' as const }))
    ],
    addLink: (path: string, id: string): void =>
      setFieldLinks((m) => (m[path]?.includes(id) ? m : { ...m, [path]: [...(m[path] ?? []), id] })),
    removeLink: (path: string, id: string): void => {
      setFieldLinks((m) => {
        const stack = (m[path] ?? []).filter((x) => x !== id)
        const n = { ...m }
        if (stack.length) n[path] = stack
        else delete n[path]
        return n
      })
      dropOverride(path, id) // an unlinked source can't stay overridden
    },
    overrides: fieldOverrides,
    // double-click a chip: the field takes over — the chip's text joins the FRONT of the field
    // (what the splice was emitting), the chip fades, and the field replaces it until reverted
    pushOverride: (path: string, id: string): void => {
      const [g, k] = path.split('.')
      const own = g === 'scene' ? ((scene as unknown as Record<string, string>)[k] ?? '') : ((production as unknown as Record<string, string>)[k] ?? '')
      const merged = [readSource(id, path), own].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
      if (g === 'scene') setScene({ ...scene, [k]: merged })
      else setProduction({ ...production, [k]: merged })
      setFieldOverrides((m) => ({ ...m, [path]: [...(m[path] ?? []).filter((x) => x !== id), id] }))
    },
    // click the faded chip: back to the link — the field CLEARS (user's call, same grammar as
    // linked characters) and the source splices live again
    revertOverride: (path: string, id: string): void => {
      const [g, k] = path.split('.')
      if (g === 'scene') setScene({ ...scene, [k]: '' })
      else setProduction({ ...production, [k]: '' })
      dropOverride(path, id)
    },
    openLink: (id: string): void => {
      if (projStyles.some((s) => s.id === id)) return openProjectStyles(id)
      setExpanded(true)
      selectClip(id)
    }
  }
  // the bundle the characters section uses to pick/show LIVE-linked characters from other clips
  const joinRefTitle = (title?: string): void => {
    if (!title || isI2v) return
    const f = fileOfTitle(title.match(/@\w+/)?.[0] ?? '')
    if (f) setRefImages((prev) => (prev.includes(f) ? prev : [...prev, f]))
  }
  const charLinking = {
    links: charLinks,
    resolve: resolveCharLink,
    clipName: (id: string): string =>
      (project?.charSheets?.find((s) => s.id === id) ? `⛉ ${project.charSheets.find((s) => s.id === id)!.name}` : undefined) ??
      project?.clips.find((c) => c.id === id)?.name ??
      '(removed)',
    // char sheets pinned on top (the character's proper home), then characters living in clips
    pickList: [
      ...(project?.charSheets ?? []).map((s) => ({ clipId: s.id, clipName: `⛉ ${s.name}`, charName: s.character.name || s.name })),
      ...(project?.clips ?? [])
        .filter((c) => c.id !== selectedClipId)
        .flatMap((c) => c.promptData.characters.filter((ch) => ch.name.trim()).map((ch) => ({ clipId: c.id, clipName: c.name, charName: ch.name })))
    ],
    add: (l: CharacterLink): void => {
      setCharLinks((ls) => (ls.some((x) => x.clipId === l.clipId && x.charName === l.charName) ? ls : [...ls, l]))
      joinRefTitle(resolveCharLink(l)?.referenceLabel) // the source's ref image rides along into this clip's refs
    },
    remove: (l: CharacterLink): void =>
      setCharLinks((ls) => ls.filter((x) => !(x.clipId === l.clipId && x.charName === l.charName))),
    setOverride: (l: CharacterLink, patch: Partial<CharacterField>): void => {
      setCharLinks((ls) =>
        ls.map((x) => {
          if (x.clipId !== l.clipId || x.charName !== l.charName) return x
          const merged: Partial<CharacterField> = { ...(x.override ?? {}), ...patch }
          for (const k of Object.keys(merged) as (keyof CharacterField)[]) if (!(merged[k] ?? '').trim()) delete merged[k]
          return { ...x, override: Object.keys(merged).length ? merged : undefined }
        })
      )
      if (patch.referenceLabel) joinRefTitle(patch.referenceLabel) // a replacement @ref joins the refs too
    },
    // double-click a chip: the field takes over — its text becomes exactly what the splice was
    // emitting (source + any append text), and the source is ignored until reverted
    replaceField: (l: CharacterLink, k: CharLinkTextKey): void => {
      const srcVal = resolveCharLink(l)?.[k] ?? ''
      setCharLinks((ls) =>
        ls.map((x) => {
          if (x.clipId !== l.clipId || x.charName !== l.charName) return x
          const pushed = [srcVal, x.override?.[k]].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
          const override: Partial<CharacterField> = { ...(x.override ?? {}) }
          if (pushed) override[k] = pushed
          else delete override[k]
          return { ...x, override: Object.keys(override).length ? override : undefined, replaced: [...(x.replaced ?? []).filter((f) => f !== k), k] }
        })
      )
    },
    // click the faded chip: back to the link — the field clears, the source splices live again
    revertField: (l: CharacterLink, k: CharLinkTextKey): void =>
      setCharLinks((ls) =>
        ls.map((x) => {
          if (x.clipId !== l.clipId || x.charName !== l.charName) return x
          const override: Partial<CharacterField> = { ...(x.override ?? {}) }
          delete override[k]
          const replaced = (x.replaced ?? []).filter((f) => f !== k)
          return { ...x, override: Object.keys(override).length ? override : undefined, replaced: replaced.length ? replaced : undefined }
        })
      ),
    open: (clipId: string): void => {
      setExpanded(true)
      selectClip(clipId)
    }
  }
  // double-click the link chip → open the linked clip in the editor and drop the cursor in its prompt
  const openLinkedClip = (): void => {
    if (!linkedClip) return
    pendingFocusRef.current = true
    selectClip(linkedClip.id)
  }
  // every @mention actually used in the prompt/fields/beats — refs NOT in here get a warning outline
  const mentionedRefs = new Set(combined.match(/@\w+/g) ?? [])
  const lint = lintFields(structured, {
    imageTitles: isI2v ? [] : refImages.map((f) => titleOf(f) ?? '').filter(Boolean),
    combined,
    autoTime,
    promptStyle
  })
  // engine-capability validation: errors BLOCK the render (each would be a paid 422 / silent drop)
  const videoSecs = videoRefs.map(vrefSec)
  const audioSecs = audioRefs.map(arefSec)
  const check = validateForm(
    {
      mode,
      promptEmpty: !combined.trim(),
      refCount: refImages.length,
      hasStart: !!startFile,
      hasEnd: !!endFile,
      duration,
      resolution,
      aspect,
      videoRefCount: videoRefs.length,
      audioRefCount: audioRefs.length,
      videoRefTotalSec: videoSecs.some((x) => x == null) ? undefined : videoSecs.reduce((s: number, x) => s + (x ?? 0), 0),
      audioRefTotalSec: audioSecs.some((x) => x == null) ? undefined : audioSecs.reduce((s: number, x) => s + (x ?? 0), 0)
    },
    model
  )
  // local-engine gate — the reason lands BEFORE the click (gating law), never a failed render
  if (model.provider === 'local' && !ltxSt.renderReady) {
    check.errors.push(
      ltxSt.fullOnly
        ? 'only full (dev bf16) is installed — its render recipe is unproven; download a distilled size (quality, standard, …) in the Models card'
        : 'LTX is not installed — pick a size in the Models card'
    )
  }

  // does the form hold ANYTHING the user typed? (drives the "not in the bin yet" warning and
  // '+ new' adopting the content instead of wiping it)
  const hasContent =
    clipName.trim() !== '' ||
    freeform.trim() !== '' ||
    beats.length > 0 ||
    refImages.length > 0 ||
    videoRefs.length > 0 ||
    audioRefs.length > 0 ||
    startFile !== '' ||
    endFile !== '' ||
    characters.length > 0 ||
    Object.values(scene).some((v) => v.trim() !== '') ||
    Object.values(production).some((v) => v.trim() !== '')
  const uncommitted = !selectedClipId && hasContent // typed content that lives ONLY in this form so far

  // estimated fal cost = $/sec(resolution) × duration ('auto' assumed 5s, flagged with *)
  const durNum = duration === 'auto' ? 5 : parseFloat(duration) || 0
  const rate = model.pricePerSec[resolution] ?? Object.values(model.pricePerSec)[0] ?? 0
  const estCost = rate * durNum
  // cost-honesty law: a local engine has no honest $/s — the estimate says what it is instead
  const estStr = model.provider === 'local' ? 'local render' : estCost > 0 ? `~$${estCost.toFixed(2)}${duration === 'auto' ? '*' : ''}` : ''

  // every take (fresh or old) plays by streaming it (media://) instead of reading bytes over IPC
  const showVideoFile = (file: string): void => {
    setVideoUrl(mediaUrl(file))
  }
  const togglePvPlay = (): void => {
    const v = previewRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }
  const togglePvMute = (): void => {
    const v = previewRef.current
    if (!v) return
    if (v.muted) {
      focusAudio(v) // claim audio (mutes the program/source/other previews)
      setPvMuted(false)
    } else {
      v.muted = true
      setPvMuted(true)
    }
  }
  const closePreview = (): void => {
    muteAll()
    setPreview(null)
  }
  // take-preview jogger (Clip Monitor grammar, seek-only: takes are immutable — no trim zones, no ↔ pill)
  const jogSet = (t: number): void => {
    if (jogPhRef.current && pvDur) jogPhRef.current.style.left = `${Math.min(100, Math.max(0, (t / pvDur) * 100))}%`
    if (jogTcRef.current) jogTcRef.current.textContent = smpte(t)
  }
  const onJogDown = (e: React.MouseEvent): void => {
    e.preventDefault() // scrub-drag must never start a native text selection across the panel
    const bar = jogBarRef.current
    const v = previewRef.current
    if (!bar || !v || !pvDur) return
    const seekTo = (clientX: number): void => {
      const r = bar.getBoundingClientRect()
      v.currentTime = Math.min(pvDur, Math.max(0, ((clientX - r.left) / r.width) * pvDur))
    }
    seekTo(e.clientX) // click = move the head
    const move = (ev: MouseEvent): void => seekTo(ev.clientX) // drag = scrub
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // the preview window's edges + slide pill (Clip Monitor grammar) — seek keeps winning elsewhere
  const jogWinDown = (which: 'in' | 'out' | 'slide', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation() // the bar underneath seeks; the handles own their gesture
    const bar = jogBarRef.current
    if (!bar || !pvDur) return
    const r = bar.getBoundingClientRect()
    const toSec = (clientX: number): number => Math.min(pvDur, Math.max(0, ((clientX - r.left) / r.width) * pvDur))
    const i0 = pvIn
    const o0 = pvOut ?? pvDur
    const x0 = e.clientX
    const move = (ev: MouseEvent): void => {
      if (which === 'in') setPvIn(Math.min(o0 - 0.25, toSec(ev.clientX)))
      else if (which === 'out') setPvOut(Math.max(i0 + 0.25, toSec(ev.clientX)))
      else {
        const d = ((ev.clientX - x0) / r.width) * pvDur
        const len = o0 - i0
        const ni = Math.min(Math.max(0, i0 + d), pvDur - len)
        setPvIn(ni)
        setPvOut(ni + len)
      }
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // completion watcher: when a queued gen for THIS panel's clip finishes, preview it (progress
  // itself lives in the Queue panel now — renders are queued, not awaited)
  const queue = useStore((s) => s.queue)
  useEffect(() => {
    const dir = useStore.getState().project?.dir
    // a done job from ANOTHER project must not select/preview its ids here — it stays
    // unconsumed and completes its story when that project is open again
    const job = queue.find((j) => j.kind === 'gen' && j.status === 'done' && !j.consumed && j.resultClipId && (!j.projectDir || j.projectDir === dir))
    if (!job) return
    useStore.getState().consumeJob(job.id)
    if (!(job.payload as RenderArgs).clipId && job.resultClipId) selectClip(job.resultClipId) // brand-new clip → select it
    if (job.resultClipId === selectedClipId || !(job.payload as RenderArgs).clipId) {
      if (job.resultFile) showVideoFile(job.resultFile)
      setStatus('done ✓ — saved to bin')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  // default the take preview to MUTED for each new clip (React's muted prop alone is unreliable)
  useEffect(() => {
    if (previewRef.current) previewRef.current.muted = true
    setPvMuted(true)
    setPvDur(0) // metadata belongs to the previous take's video
    setPvIn(0) // the in/out window was a choice about the PREVIOUS take
    setPvOut(null)
    if (jogPhRef.current) jogPhRef.current.style.left = '0%'
    if (jogTcRef.current) jogTcRef.current.textContent = smpte(0)
  }, [videoUrl])
  // jogger follows playback — imperative playhead + timecode so playback never re-renders per frame (canon)
  useEffect(() => {
    if (!videoUrl || !pvPlaying) return
    let raf = 0
    const tick = (): void => {
      const v = previewRef.current
      if (v) jogSet(v.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, pvPlaying, pvDur])
  // keep the 🔊 icon synced when another player grabs audio ownership
  useEffect(
    () =>
      subAudio(() => {
        if (previewRef.current) setPvMuted(previewRef.current.muted)
      }),
    []
  )
  // pause the inline preview while the ⤢ overlay is open (never two players at once)
  useEffect(() => {
    if (preview) previewRef.current?.pause()
  }, [preview])
  // spacebar (Clip Gen fronted) drives the take preview — same grammar as the Clip Monitor's.
  // Reads the element directly: no stale closures, returns false when nothing is previewed.
  useEffect(() => {
    setClipGenPlayToggle(() => {
      const v = previewRef.current
      if (!v || !v.src) return false
      if (v.paused) void v.play()
      else v.pause()
      return true
    })
    return () => setClipGenPlayToggle(null)
  }, [])
  // I / O (Clip Gen fronted) mark the preview window at the playhead — ref mirrors keep the
  // mount-once registration reading FRESH values, never stale closures
  const pvDurRef = useRef(0)
  const pvWinRef = useRef<{ in: number; out: number | null }>({ in: 0, out: null })
  useEffect(() => {
    pvDurRef.current = pvDur
  }, [pvDur])
  useEffect(() => {
    pvWinRef.current = { in: pvIn, out: pvOut }
  }, [pvIn, pvOut])
  useEffect(() => {
    setClipGenMarkInOut((which) => {
      const v = previewRef.current
      const dur = pvDurRef.current
      if (!v || !v.src || !dur) return false
      const t = Math.min(dur, Math.max(0, v.currentTime))
      const w = pvWinRef.current
      if (which === 'in') setPvIn(Math.min(t, (w.out ?? dur) - 0.25))
      else setPvOut(Math.max(t, w.in + 0.25))
      return true
    })
    return () => setClipGenMarkInOut(null)
  }, [])

  useEffect(() => {
    if (!selectedClipId || !project) return
    const c = project.clips.find((x) => x.id === selectedClipId)
    if (!c) return
    if (adoptRef.current) {
      // '+ new' just adopted the user's typed content into this fresh clip — KEEP the form exactly
      // as typed (the autosave persists it); loading the blank clip over it was the lost-work bug
      adoptRef.current = false
      setStatus(`added to bin${clipName.trim() ? ': ' + clipName.trim() : ''}`)
      return
    }
    loadingRef.current = true // suppress auto-save while we populate from the clip
    beatsDirtyRef.current = false // freshly loaded → beats not locally edited yet
    const pd = c.promptData as PromptData & { prompt?: string }
    const fileOfId = (id?: string): string | undefined => (id ? project.images.find((i) => i.id === id)?.file : undefined)
    setClipName(c.name)
    setEngine(pd.engine ?? DEFAULT_ENGINE)
    setMode(pd.mode === 'v2v' ? 'ref2v' : pd.mode) // edit clips belong to the Video Editor — never render them as v2v from here
    setFreeform(pd.freeform ?? pd.prompt ?? '')
    setScene(pd.scene ?? { ...EMPTY_SCENE })
    setCharacters(pd.characters ?? [])
    setBeats(pd.beats ?? [])
    lastSavedBeatsRef.current = JSON.stringify(pd.beats ?? []) // baseline for external-writer detection
    setProduction(pd.production ?? { ...EMPTY_PRODUCTION })
    setDuration(pd.duration)
    setResolution(pd.resolution)
    setAspect(pd.aspectRatio)
    setAudio(pd.generateAudio)
    setPromptLink(pd.promptLink ?? null)
    setLinkPicker(false)
    // disk migration wraps pre-v6 single-id links; normalize here too so a stray string can't crash the stack UI
    const fl: Record<string, string[]> = {}
    for (const [lp, v] of Object.entries(pd.fieldLinks ?? {})) {
      const stack = (Array.isArray(v) ? v : [v as unknown as string]).filter((x): x is string => typeof x === 'string' && !!x)
      if (stack.length) fl[lp] = stack
    }
    setFieldLinks(fl)
    setFieldOverrides(pd.fieldOverrides ?? {})
    setCharLinks(pd.characterLinks ?? [])
    setEnhancedPaths(pd.enhanced ?? [])
    setVideoRefs(pd.videoRefs ?? [])
    setAudioRefs(pd.audioRefs ?? [])
    if (pd.mode === 'i2v') {
      const fs = (pd.imageIds ?? []).map(fileOfId).filter((f): f is string => Boolean(f))
      setStartFile(fs[0] ?? '')
      setEndFile(fileOfId(pd.endImageId) ?? '')
      setRefImages([])
    } else {
      setRefImages((pd.imageIds ?? []).map(fileOfId).filter((f): f is string => Boolean(f)))
      setStartFile('')
      setEndFile('')
    }
    const slot = editTimelineIndex != null ? activeItems(project)[editTimelineIndex] : undefined
    const inSlot = !!slot && slot.clipId === selectedClipId
    if (inSlot && slot!.useRecipe) {
      // the slot is set to "C" — the live recipe view. Never load a take's video here (re-entering
      // the slot used to fall back to the keeper take and silently override the user's C choice)
      setVideoUrl(null)
    } else {
      const shownTakeId = (inSlot ? slot!.takeId : undefined) ?? c.keeperTakeId
      const take = c.takes.find((t) => t.id === shownTakeId) ?? c.takes[c.takes.length - 1]
      if (take) showVideoFile(take.file)
      else setVideoUrl(null) // storyboard clip — nothing rendered yet
    }
    setStatus(inSlot ? `timeline clip — slot ${editTimelineIndex! + 1}${slot!.useRecipe ? ' · C — live recipe' : ''}` : 'loaded: ' + c.name)
    if (pendingFocusRef.current) {
      // arrived here by double-clicking a link chip → drop the cursor in the prompt, scrolled into view
      pendingFocusRef.current = false
      setTimeout(() => {
        const ta = taRef.current
        if (!ta) return
        ta.focus()
        ta.scrollIntoView({ block: 'nearest' })
        ta.setSelectionRange(0, 0)
      }, 0)
    }
    // loadingRef stays true; the auto-save effect consumes it (skips exactly the load-triggered save)
    // reads `project` via closure on purpose — only reload when the selection changes, not on every edit
    // (undoTick is included so undo/redo re-pulls the restored prompt into the live form)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId, editTimelineIndex, undoTick])

  // adopt EXTERNAL beats edits (the Clip Monitor saves beats too): when the stored beats change and
  // differ from our local copy, the other panel won — take its version and drop any pending stale save.
  // (without this, our 600ms debounced full-form save could fire with stale beats and clobber theirs)
  const storeBeats = selectedClipId ? project?.clips.find((x) => x.id === selectedClipId)?.promptData.beats : undefined
  useEffect(() => {
    if (loadingRef.current || !storeBeats) return
    const incoming = JSON.stringify(storeBeats)
    // an EXTERNAL writer (Co-Director / Clip Monitor) moved the stored beats — they differ from
    // what WE last loaded/saved. External wins recency: adopt and DROP our pending stale save,
    // even mid-edit. (This was the clobber: our debounced old-beats save used to overwrite a
    // fresh Co-Director write and the change "didn't take".)
    if (incoming !== lastSavedBeatsRef.current) {
      lastSavedBeatsRef.current = incoming
      beatsDirtyRef.current = false
      setBeats((curr) => (JSON.stringify(curr) === incoming ? curr : storeBeats))
      return
    }
    if (beatsDirtyRef.current) return // our own echo while mid-edit — our debounced save stays the newest intent
    setBeats((curr) => (JSON.stringify(curr) === incoming ? curr : storeBeats))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeBeats])

  // an image's FILE swapped under the same id (primary version change) → repoint our live ref paths,
  // otherwise the debounced autosave's file→id lookup misses and silently DROPS the ref
  useEffect(() => {
    if (fileSwap.n === lastSwapN.current) return
    lastSwapN.current = fileSwap.n
    const { from, to } = fileSwap
    if (!from || !to) return
    setRefImages((arr) => (arr.includes(from) ? arr.map((f) => (f === from ? to : f)) : arr))
    setStartFile((f) => (f === from ? to : f))
    setEndFile((f) => (f === from ? to : f))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileSwap])

  // an image was renamed → rewrite @old→@new in our LIVE form text (the stored copy + the refs-strip
  // thumbnail already updated via the delta; this catches the editor's stale local prompt/beats/fields)
  useEffect(() => {
    if (renameSignal.n === lastRenameN.current) return
    lastRenameN.current = renameSignal.n
    const { from, to } = renameSignal
    if (!from || !to) return
    const pat = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', 'g')
    const sw = (s: string): string => s.replace(pat, to)
    // preserve the caret if the user happens to be typing in the prompt when the rename lands
    const ta = taRef.current
    const caret = ta && document.activeElement === ta ? ta.selectionStart ?? null : null
    setFreeform((f) => {
      const r = sw(f)
      if (caret != null && r !== f) setTimeout(() => ta?.setSelectionRange(Math.min(caret, r.length), Math.min(caret, r.length)), 0)
      return r
    })
    setScene((s) => ({ ...s, referenceHandling: sw(s.referenceHandling) }))
    setCharacters((cs) => cs.map((c) => ({ ...c, referenceLabel: sw(c.referenceLabel) })))
    setBeats((bs) =>
      bs.map((b) => ({
        ...b,
        camera: sw(b.camera),
        action: sw(b.action),
        lighting: sw(b.lighting),
        ...(b.dialogue ? { dialogue: sw(b.dialogue) } : {}),
        ...(b.vfx ? { vfx: sw(b.vfx) } : {}),
        ...(b.reaction ? { reaction: sw(b.reaction) } : {}),
        ...(b.sfx ? { sfx: sw(b.sfx) } : {})
      }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal])

  const addRef = (file: string): void => {
    setRefImages((prev) => (prev.includes(file) ? prev : [...prev, file]))
    const t = titleOf(file)
    if (t) setFreeform((p) => (p.includes(t) ? p : p.trim() ? p.trim() + ' ' + t : t))
  }
  // beats also accept @refs: any @title in a beat's text joins the clip's ref library (ref2v) —
  // and so does a beat's MANUAL placeholder graphic (the model must receive it, just un-pinned)
  const onBeatsChange = (next: BeatField[]): void => {
    beatsDirtyRef.current = true // user edited beats in the Inspector → safe to persist them
    clearEnhanced('beats') // hand-edited → no longer AI-marked
    setBeats(next)
    if (!isI2v) {
      const text = next
        .map((b) => [b.camera, b.action, b.lighting, b.dialogue, b.vfx, b.reaction, b.sfx].filter(Boolean).join(' '))
        .join(' ')
      const files = (text.match(/@\w+/g) ?? []).map((t) => fileOfTitle(t)).filter((f): f is string => !!f)
      const graphicFiles = next
        .map((b) => (b.refImageId ? libImages.find((i) => i.id === b.refImageId)?.file : undefined))
        .filter((f): f is string => !!f)
      const all = [...files, ...graphicFiles]
      if (all.length)
        setRefImages((prev) => {
          const add = all.filter((f) => !prev.includes(f))
          return add.length ? [...prev, ...add] : prev // no-op guard — same ref when nothing new
        })
    }
  }
  // characters also feed the ref library: a linked @ref image joins the clip's refs (ref2v),
  // same two-way rule as @mentions in the prompt and beats
  const onCharactersChange = (next: CharacterField[]): void => {
    setCharacters(next)
    if (!isI2v) {
      const files = next
        .map((ch) => ch.referenceLabel.match(/@\w+/)?.[0])
        .map((t) => (t ? fileOfTitle(t) : undefined))
        .filter((f): f is string => !!f)
      if (files.length)
        setRefImages((prev) => {
          const add = files.filter((f) => !prev.includes(f))
          return add.length ? [...prev, ...add] : prev // no-op guard — same ref when nothing new
        })
    }
  }
  // resolved reference-image url for a beat (its @ref, else the prompt's), shown in the beat editor
  const beatRefUrl = (b: BeatField): string | undefined => {
    const f = beatRefFile(b, freeform, project?.images ?? [])
    return f ? mediaUrl(f) : undefined
  }
  const assign = (file: string): void => {
    if (picker === 'ref') addRef(file)
    else if (picker === 'start') setStartFile(file)
    else if (picker === 'end') setEndFile(file)
    setPicker(null)
  }
  const pickerImport = async (): Promise<void> => {
    // importToLibrary already merged the new images into the store via its delta — a full projectGet
    // + setProject here would REPLACE the project and clobber any concurrent edits
    const ids = await importToLibrary()
    const proj = useStore.getState().project
    const f = ids[0] ? proj?.images.find((i) => i.id === ids[0])?.file : undefined
    if (f) assign(f)
  }
  const onDropImage = (e: React.DragEvent, target: 'ref' | 'start' | 'end'): void => {
    e.preventDefault()
    setDragTarget(null)
    const f = e.dataTransfer.getData(MIME_IMAGE)
    if (!f) return
    if (target === 'start') setStartFile(f)
    else if (target === 'end') setEndFile(f)
    else addRef(f)
  }
  const onPromptDrop = (e: React.DragEvent<HTMLTextAreaElement>): void => {
    const f = e.dataTransfer.getData(MIME_IMAGE)
    if (!f) return
    e.preventDefault()
    const t = titleOf(f)
    if (!t) return
    const ta = taRef.current
    const pos = ta?.selectionStart ?? freeform.length
    const before = freeform.slice(0, pos)
    const after = freeform.slice(pos)
    const insert = (before && !before.endsWith(' ') ? ' ' : '') + t + ' '
    setFreeform(before + insert + after)
    if (!isI2v) setRefImages((prev) => (prev.includes(f) ? prev : [...prev, f]))
    setTimeout(() => {
      ta?.focus()
      const c = (before + insert).length
      ta?.setSelectionRange(c, c)
    }, 0)
  }

  const onFreeform = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setFreeform(val)
    const pos = e.target.selectionStart ?? val.length
    const m = val.slice(0, pos).match(/@(\w*)$/)
    setMention(m ? { start: pos - m[0].length, query: m[1].toLowerCase() } : null)
    // two-way @refs: any @title in the prompt that matches a library image joins this clip's refs.
    // NO-OP GUARD: return the SAME array when nothing new joins — a content-equal fresh reference
    // still counts as a state change and can fuel update cascades
    if (!isI2v) {
      const files = (val.match(/@\w+/g) ?? []).map((t) => fileOfTitle(t)).filter((f): f is string => !!f)
      if (files.length)
        setRefImages((prev) => {
          const add = files.filter((f) => !prev.includes(f))
          return add.length ? [...prev, ...add] : prev
        })
    }
  }
  const pickMention = (title: string): void => {
    if (!mention) return
    const ta = taRef.current
    const pos = ta?.selectionStart ?? freeform.length
    const before = freeform.slice(0, mention.start)
    const after = freeform.slice(pos)
    setFreeform(before + title + ' ' + after)
    setMention(null)
    if (!isI2v) {
      const f = fileOfTitle(title)
      if (f) setRefImages((prev) => (prev.includes(f) ? prev : [...prev, f]))
    }
    setTimeout(() => {
      ta?.focus()
      const c = (before + title + ' ').length
      ta?.setSelectionRange(c, c)
    }, 0)
  }
  const mentionMatches = mention
    ? libImages.filter((i) => i.title.toLowerCase().includes(mention.query)).slice(0, 8)
    : []

  // project switched with nothing selected → the form still holds the PREVIOUS project's content;
  // clear it so '+ new' can't adopt leftovers into the wrong project
  useEffect(() => {
    if (project?.dir === projDirRef.current) return
    projDirRef.current = project?.dir
    if (selectedClipId) return // a real selection will load over the form anyway
    setClipName('')
    setEngine(DEFAULT_ENGINE)
    setMode('ref2v')
    setFreeform('')
    setScene({ ...EMPTY_SCENE })
    setCharacters([])
    setCharLinks([])
    setBeats([])
    setProduction({ ...EMPTY_PRODUCTION })
    setRefImages([])
    setStartFile('')
    setEndFile('')
    setDuration('5')
    setResolution('720p')
    setAspect('auto')
    setAudio(true)
    setVideoUrl(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.dir])

  const newClip = (): void => {
    if (uncommitted) {
      // the form holds typed-but-uncommitted content: '+ new' ADOPTS it into the new clip
      // (it used to load the blank clip over the form and wipe the user's work)
      adoptRef.current = true
      void createClip().then((id) => {
        if (id && clipName.trim()) void renameClip(id, clipName.trim())
        if (!id) adoptRef.current = false // creation failed — don't poison the next load
      })
      return
    }
    void createClip() // creates a real blank (storyboard) clip + selects it; the load effect empties the form
  }
  const commitName = (): void => {
    if (selectedClipId && clipName.trim()) void renameClip(selectedClipId, clipName.trim())
  }
  // carry images across a mode toggle so flipping ref2v↔i2v never silently drops frames
  const switchMode = (m: 'ref2v' | 'i2v'): void => {
    if (m === mode) return
    if (m === 'i2v') {
      if (!startFile && refImages[0]) setStartFile(refImages[0])
    } else if (refImages.length === 0) {
      setRefImages([startFile, endFile].filter(Boolean) as string[])
    }
    setMode(m)
  }
  const playTake = (file: string): void => {
    showVideoFile(file)
  }

  const idOfFile = (f: string): string | undefined => useStore.getState().project?.images.find((i) => i.file === f)?.id
  // assemble the clip's prompt data from the current form (library files → image ids)
  const buildPromptData = (): PromptData => {
    const refs = isI2v ? [startFile].filter(Boolean) : refImages
    return {
      engine,
      mode,
      freeform,
      scene,
      characters,
      beats,
      production,
      imageIds: refs.map((f) => idOfFile(f)).filter((x): x is string => !!x),
      endImageId: isI2v ? idOfFile(endFile) : undefined,
      videoRefs: videoRefs.length ? videoRefs : undefined,
      audioRefs: audioRefs.length ? audioRefs : undefined,
      duration,
      resolution,
      aspectRatio: aspect,
      generateAudio: audio,
      promptLink: promptLink ?? undefined,
      fieldLinks: Object.keys(fieldLinks).length ? fieldLinks : undefined,
      fieldOverrides: Object.keys(fieldOverrides).length ? fieldOverrides : undefined,
      characterLinks: charLinks.length ? charLinks : undefined,
      enhanced: enhancedPaths.length ? enhancedPaths : undefined
    }
  }
  // auto-save the form to the selected clip (debounced) so storyboard clips keep their recipe
  useEffect(() => {
    if (!selectedClipId) return
    if (loadingRef.current) {
      loadingRef.current = false // consume the load-triggered run; persist real edits after this
      return
    }
    const id = selectedClipId
    // only persist beats if they were edited HERE — otherwise another panel (Clip Preview) owns the latest
    // beats and a full save with our (possibly stale) beats would clobber them. saveClipPromptData merges.
    const sentBeats = beatsDirtyRef.current
    const payload: Partial<PromptData> = { ...buildPromptData() }
    if (!sentBeats) delete payload.beats
    const t = window.setTimeout(() => {
      if (sentBeats && payload.beats) lastSavedBeatsRef.current = JSON.stringify(payload.beats) // OUR write — its echo isn't "external"
      void saveClipPromptData(id, payload)
      if (sentBeats) beatsDirtyRef.current = false
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, mode, freeform, scene, characters, charLinks, beats, production, refImages, videoRefs, audioRefs, startFile, endFile, duration, resolution, aspect, audio, promptLink, fieldLinks, fieldOverrides, enhancedPaths, selectedClipId])

  const submitRender = (lane: 'queue' | 'now'): void => {
    if (check.errors.length) return setStatus('fix first: ' + check.errors[0])
    // `combined` is already in this engine's flavor — only the ref-tag rewrite is outgoing-only
    // (the visible prompt keeps @titles; the wire prompt binds refs as <IMAGE_REF_n>)
    const m = modelFor(engine)
    let outPrompt = combined
    if (m.refTagPrompt && !isI2v && refImages.length) outPrompt = applyRefTags(outPrompt, refImages.map((f) => titleOf(f) ?? ''))
    // two lanes (docs/CONCURRENT-RENDERS-SPEC-2026-08-11.md): queue = serial in order, now =
    // starts immediately alongside anything running. The Queue panel owns progress/cancel either way.
    // Slot adoption is captured by stable item id NOW; the runner applies it when the take lands.
    const dispatch = lane === 'now' ? useStore.getState().renderNow : useStore.getState().enqueueRender
    dispatch({
      kind: 'gen',
      label: clipName.trim() || selClip?.name || 'clip',
      thumb: isI2v ? startFile || undefined : refImages[0],
      engineLabel: m.label,
      estCost: estCost > 0 ? estCost : undefined,
      adoptSlotItemId: editingSlot && editTimelineIndex != null ? tlItems[editTimelineIndex]?.id : undefined,
      payload: {
        engine,
        mode,
        prompt: outPrompt,
        freeform,
        scene,
        characters,
        beats,
        production,
        images: isI2v ? [startFile] : refImages,
        endImage: isI2v ? endFile || undefined : undefined,
        // sent ONLY when the engine takes them — parked slots stay visible in the UI, never on the wire
        videoRefs: !isI2v && m.maxRefVideos > 0 && videoRefs.length ? videoRefs : undefined,
        audioRefs: !isI2v && m.maxRefAudios > 0 && audioRefs.length ? audioRefs : undefined,
        duration,
        resolution,
        aspectRatio: aspect,
        generateAudio: audio,
        promptLink: promptLink ?? undefined,
        fieldLinks: Object.keys(fieldLinks).length ? fieldLinks : undefined,
        fieldOverrides: Object.keys(fieldOverrides).length ? fieldOverrides : undefined,
        characterLinks: charLinks.length ? charLinks : undefined,
        clipId: selectedClipId ?? undefined,
        name: clipName || undefined
      }
    })
    setStatus(lane === 'now' ? 'rendering now — watch the Queue panel' : 'queued → watch the Queue panel')
  }

  const selClip = selectedClipId ? project?.clips.find((c) => c.id === selectedClipId) : undefined
  // which take the big preview is showing (matched by file) — its FROZEN snapshot beats band the
  // jogger (WORKFLOW law: beats stay visible wherever a clip is shown)
  const pvTake = videoUrl && selClip ? selClip.takes.find((t) => mediaUrl(t.file) === videoUrl) : undefined
  const pvTakeNum = pvTake && selClip ? selClip.takes.indexOf(pvTake) + 1 : 0
  const pvBeats = pvTake?.snapshot?.beats ?? []
  const pvRanges = beatRanges(pvBeats)
  const jogDur = pvDur || (pvRanges.length ? pvRanges[pvRanges.length - 1].end : 0)
  const pvWindowed = pvIn > 0.01 || (pvOut != null && pvDur > 0 && pvOut < pvDur - 0.01)
  const pvBeatImg = (i: number): string | undefined => {
    const f = beatRefFile(pvBeats[i], pvTake?.snapshot?.freeform ?? '', project?.images ?? [])
    return f ? mediaUrl(f) : undefined
  }
  const takes = selClip?.takes ?? []
  const tlItems = activeItems(project)
  const editingSlot = editTimelineIndex != null && tlItems[editTimelineIndex]?.clipId === selectedClipId
  const slotUsesRecipe = editingSlot && !!tlItems[editTimelineIndex!].useRecipe
  const slotTakeId = slotUsesRecipe
    ? undefined // the slot shows the live recipe ("C"), no take is active
    : editingSlot
      ? tlItems[editTimelineIndex!].takeId ?? selClip?.keeperTakeId
      : selClip?.keeperTakeId
  // C chip: point the edited timeline slot at the LIVE recipe instead of a take. C ignores trims
  // (it always spans the live recipe duration) so clear any stored in/out too. For a BIN-selected
  // clip (no slot) C is a PREVIEW choice: the Clip Monitor switches to the recipe view (thumb+beats).
  const previewRecipe = useStore((s) => s.previewRecipe)
  const pickRecipeForSlot = (): void => {
    if (editingSlot && editTimelineIndex != null) {
      // via setSlotView so the block's length change RIPPLES what follows (same as any take switch)
      const slotId = tlItems[editTimelineIndex]?.id
      if (slotId) void useStore.getState().setSlotView(slotId, { useRecipe: true })
    } else {
      useStore.getState().setPreviewRecipe(true) // bin mode → the Clip Monitor shows the live recipe
    }
    setVideoUrl(null) // editor preview drops to the recipe (storyboard) view
  }
  // (first/last-frame live stills moved OUT of this panel — they live on the Timeline block's
  // right-click menu and the Clip Monitor's slot-edit toolbar now, next to where the gesture starts)

  // ---- drag a T-chip onto a field → restore JUST that field from the take's frozen snapshot ----
  type TakeField = 'prompt' | 'fields' | 'beats' | 'refs' | 'start' | 'end' | 'duration' | 'resolution' | 'aspect' | 'audio' | 'engine' | 'mode'
  const isTakeDrag = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types || []).includes(MIME_TAKE)
  const takeFromDrag = (e: React.DragEvent): Take | undefined => {
    const d = e.dataTransfer.getData(MIME_TAKE)
    if (!d) return undefined
    try {
      const o = JSON.parse(d) as { clipId?: string; takeId?: string }
      if (o.clipId !== selectedClipId) return undefined // only THIS clip's takes restore into the form
      return selClip?.takes.find((t) => t.id === o.takeId)
    } catch {
      return undefined
    }
  }
  // mark a field as a take-drop target (highlight while a T-chip hovers it)
  const takeOver = (field: TakeField) => (e: React.DragEvent): void => {
    if (!isTakeDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setTakeDrop(field)
  }
  const takeHL = (field: TakeField): React.CSSProperties | undefined =>
    takeDrop === field ? { outline: '1px dashed var(--amber)', outlineOffset: 2, borderRadius: 4 } : undefined
  const onTakeDrop = (field: TakeField, e: React.DragEvent): boolean => {
    if (!isTakeDrag(e)) return false
    e.preventDefault()
    e.stopPropagation()
    setTakeDrop(null)
    const take = takeFromDrag(e)
    if (!take || !selClip) return true
    const tn = selClip.takes.findIndex((t) => t.id === take.id) + 1
    const snap = take.snapshot
    if (!snap) {
      setStatus(`take ${tn} predates snapshots — nothing to restore`)
      return true
    }
    const fileOfId = (id?: string): string | undefined => (id ? project?.images.find((i) => i.id === id)?.file : undefined)
    switch (field) {
      case 'prompt':
        setFreeform(snap.freeform)
        break
      case 'fields':
        setScene({ ...snap.scene })
        setCharacters(snap.characters.map((c) => ({ ...c })))
        setProduction({ ...snap.production })
        break
      case 'beats':
        // restore the take's beats, RESCALED proportionally to the CURRENT duration setting
        beatsDirtyRef.current = true
        setBeats(fitArr(snap.beats.map((b) => ({ ...b })), durNum))
        break
      case 'refs':
        setRefImages((snap.imageIds ?? []).map(fileOfId).filter((f): f is string => !!f))
        setVideoRefs((snap.videoRefs ?? []).map((r) => ({ ...r })))
        setAudioRefs((snap.audioRefs ?? []).map((r) => ({ ...r })))
        break
      case 'start': {
        const f = fileOfId(snap.imageIds?.[0])
        if (f) setStartFile(f)
        break
      }
      case 'end': {
        const f = fileOfId(snap.endImageId)
        if (f) setEndFile(f)
        break
      }
      case 'duration':
        setDuration(snap.duration)
        break
      case 'resolution':
        setResolution(snap.resolution)
        break
      case 'aspect':
        setAspect(snap.aspectRatio)
        break
      case 'audio':
        setAudio(snap.generateAudio)
        break
      case 'engine':
        setEngine(snap.engine ?? DEFAULT_ENGINE)
        break
      case 'mode':
        setMode(snap.mode === 'v2v' ? 'ref2v' : snap.mode)
        break
    }
    setStatus(`↩ ${field} restored from take ${tn}`)
    return true
  }

  // ---- collapsible section landmarks (setup / prompt / beats / refs / takes) ----
  const toggleSec = (id: string): void =>
    setClosedSecs((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  // render-helper (NOT a component) so section children keep identity across toggles
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

  // nothing selected and nothing typed: the house empty state (uncommitted typed content keeps
  // the form — the EmptyState must never eat work the '+ new' adopt flow protects)
  if (!selectedClipId && !hasContent) {
    return (
      <EmptyState>
        no clip open — double-click a clip in the Bin, or start one fresh
        <br />
        <span className="btn vd-hbtn" style={{ marginTop: 8, display: 'inline-block' }} onClick={newClip}>
          ＋ new clip
        </span>
      </EmptyState>
    )
  }

  return (
    <div className="vd-panel vd-inspector" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
      <div className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={clipName}
          onChange={(e) => setClipName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
          placeholder="clip name"
          style={{ ...ctl, flex: 1 }}
        />
        <span className="btn vd-hbtn" onClick={newClip} title={uncommitted ? 'save this as a clip in the Bin' : 'start a new blank clip'}>
          + new
        </span>
      </div>

      {uncommitted && (
        <div className="field" style={{ fontSize: 10, color: 'var(--amber)', border: '1px dashed var(--amber-dim)', borderRadius: 4, padding: '4px 8px' }}>
          ⚠ not in the Bin yet — “+ new” saves it as a clip · ▶ Render also commits it
        </div>
      )}

      {videoUrl && (
        <div className="field" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="lb" style={{ margin: 0 }}>preview</span>
            <span className="btn vd-hbtn" onClick={togglePvPlay} title="play / pause"><Ic i={pvPlaying ? Pause : Play} size={11} /></span>
            <span className="btn vd-hbtn" onClick={togglePvMute} title="mute / unmute"><Ic i={pvMuted ? VolumeX : Volume2} size={11} /></span>
            <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setPreview(videoUrl)}><Ic i={Maximize2} size={11} /> preview</span>
          </div>
          <div ref={pvBoxRef} style={{ height: previewH, background: '#000', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <video
              ref={previewRef}
              src={videoUrl}
              autoPlay
              loop
              muted={pvMuted}
              draggable={!!pvTake}
              onDragStart={(e) => {
                // the big preview drags as its take — same payload as the T-chips, so every
                // take target works: timeline (places clip @ this take), Library (imports as
                // video), @video ref slots, Video Editor. An in/out window rides along and
                // lands as the timeline item's trim.
                if (!pvTake || !selClip) return
                const winIn = pvIn > 0.01 ? pvIn : undefined
                const winOut = pvOut != null && pvDur > 0 && pvOut < pvDur - 0.01 ? pvOut : undefined
                e.dataTransfer.setData(MIME_TAKE, JSON.stringify({ clipId: selClip.id, takeId: pvTake.id, inSec: winIn, outSec: winOut }))
              }}
              title={pvTake ? 'click = play / pause · drag = onto the timeline (in/out window rides along), the Library, or a @video ref slot' : 'click = play / pause'}
              onClick={togglePvPlay}
              onPlay={() => setPvPlaying(true)}
              onPause={() => setPvPlaying(false)}
              onLoadedMetadata={(e) => setPvDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => jogSet(e.currentTarget.currentTime)}
              onVolumeChange={(e) => {
                const v = e.currentTarget
                if (!v.muted) focusAudio(v)
                setPvMuted(v.muted)
              }}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'pointer' }}
            />
          </div>
          <ResizeHandle
            value={previewH}
            maxOf={() => {
              // the preview lives inside the .vd-scroll body — cap at its viewport minus breathing room
              const sc = pvBoxRef.current?.closest('.vd-scroll') as HTMLElement | null
              return (sc?.clientHeight ?? 640) - 60
            }}
            onChange={(h) => setPreviewH('render', h)}
          />
          {/* take jogger — Clip Monitor grammar (22px --raised2 bar, seek wins everywhere, imperative
              head + timecode). Seek-only: takes are immutable, so no trim hot-zones and no ↔ pill. */}
          <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--txt-hi)', letterSpacing: 0.5, margin: '4px 0' }}>
            <span ref={jogTcRef} />
            <span style={{ color: 'var(--dim)', fontSize: 11 }}> / {smpte(jogDur)}</span>
          </div>
          <div ref={jogBarRef} onMouseDown={onJogDown} style={{ position: 'relative', height: 22, background: 'var(--raised2)', borderRadius: 4, cursor: 'pointer', overflow: 'hidden', userSelect: 'none' }} title="click / drag to scrub the take">
            {/* the take's FROZEN snapshot beats band the bar, like the timeline block */}
            {pvBeats.length > 0 &&
              jogDur > 0 &&
              pvRanges.map((r, i) => (
                <div
                  key={i}
                  title={pvBeats[i].name || `beat ${i + 1}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(r.start / jogDur) * 100}%`,
                    width: `${((r.end - r.start) / jogDur) * 100}%`,
                    background: pvBeatImg(i) ? `var(--bg) center/contain no-repeat url("${pvBeatImg(i)}")` : BEAT_COLORS[i % BEAT_COLORS.length],
                    opacity: pvBeatImg(i) ? 1 : 0.4,
                    boxShadow: 'inset -1px 0 0 0 rgba(0,0,0,.45)',
                    pointerEvents: 'none' // PURELY VISUAL — the bar just scrubs
                  }}
                />
              ))}
            {/* in/out window — click-transparent region (seek wins), VISIBLE bracket handles trim
                (dim at rest, amber when set), the ↔ pill alone slides. A drag onto the timeline
                lands pre-trimmed to this window. I / O set the edges at the playhead. */}
            {pvDur > 0 && pvWindowed && (
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(pvIn / jogDur) * 100}%`, width: `${(((pvOut ?? jogDur) - pvIn) / jogDur) * 100}%`, background: 'color-mix(in srgb, var(--amber) 22%, transparent)', borderLeft: '2px solid var(--amber)', borderRight: '2px solid var(--amber)', pointerEvents: 'none', zIndex: 2 }} />
            )}
            {pvDur > 0 && (
              <>
                <div onMouseDown={(e) => jogWinDown('in', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(pvIn / jogDur) * 100}%`, width: 10, marginLeft: -5, cursor: 'ew-resize', zIndex: 3 }} title={`in ${pvIn.toFixed(2)}s — drag to trim (or press I at the playhead) · sets what a timeline drag places`}>
                  <div style={{ position: 'absolute', left: 4, top: 0, bottom: 0, width: 2, background: pvWindowed ? 'var(--amber)' : 'var(--amber-dim)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: 4, top: 0, width: 6, height: 2, background: pvWindowed ? 'var(--amber)' : 'var(--amber-dim)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: 4, bottom: 0, width: 6, height: 2, background: pvWindowed ? 'var(--amber)' : 'var(--amber-dim)', pointerEvents: 'none' }} />
                </div>
                <div onMouseDown={(e) => jogWinDown('out', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((pvOut ?? jogDur) / jogDur) * 100}%`, width: 10, marginLeft: -5, cursor: 'ew-resize', zIndex: 3 }} title={`out ${(pvOut ?? jogDur).toFixed(2)}s — drag to trim (or press O at the playhead) · sets what a timeline drag places`}>
                  <div style={{ position: 'absolute', right: 4, top: 0, bottom: 0, width: 2, background: pvWindowed ? 'var(--amber)' : 'var(--amber-dim)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', right: 4, top: 0, width: 6, height: 2, background: pvWindowed ? 'var(--amber)' : 'var(--amber-dim)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', right: 4, bottom: 0, width: 6, height: 2, background: pvWindowed ? 'var(--amber)' : 'var(--amber-dim)', pointerEvents: 'none' }} />
                </div>
                {pvWindowed && (
                  <div
                    onMouseDown={(e) => jogWinDown('slide', e)}
                    title="grab to slide the in/out window"
                    style={{ position: 'absolute', left: `${(((pvIn + (pvOut ?? jogDur)) / 2) / jogDur) * 100}%`, top: '50%', transform: 'translate(-50%, -50%)', height: 16, minWidth: 22, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', zIndex: 4, color: 'var(--raised)', background: 'var(--amber)', borderRadius: 8, fontSize: 11, fontWeight: 700, lineHeight: 1, userSelect: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,.35)' }}
                  >
                    ↔
                  </div>
                )}
              </>
            )}
            <div ref={jogPhRef} style={{ position: 'absolute', top: 0, bottom: 0, left: '0%', width: 2, background: '#fff', pointerEvents: 'none', zIndex: 5 }} />
          </div>
          {pvTakeNum > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 3 }}>
              <span>in {pvIn.toFixed(2)}s</span>
              <span style={{ color: 'var(--muted)' }}>
                take {pvTakeNum}/{selClip!.takes.length}
                {pvTake!.id === selClip!.keeperTakeId ? ' ★' : ''}
                {pvWindowed ? ' · window rides the drag' : ''}
              </span>
              <span>out {(pvOut ?? jogDur).toFixed(2)}s</span>
            </div>
          )}
        </div>
      )}

      {takes.length > 0 && sec('takes', 'takes & versions', (
        <div className="field" style={{ marginTop: 2 }}>
          <div className="lb">
            {editingSlot ? `takes — sets this slot (#${editTimelineIndex! + 1})` : 'takes — click = keeper'}
            <span style={{ color: 'var(--dim)' }}> · drag a card onto any field to restore it from that take · right-click = color / disable</span>
          </div>
          {editingSlot && takes.length > 1 && (
            <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 6 }}>
              ▦ the take you pick applies to THIS slot only — all other edits affect the whole clip.
            </div>
          )}
          <div className="vd-slots" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
            {/* S-B = the storyboard / live recipe (duration setting + current beats + keyframe) — always first */}
            <span
              className={'vd-slot' + (slotUsesRecipe || (!editingSlot && previewRecipe) ? ' filled' : '')}
              onClick={pickRecipeForSlot}
              title={
                editingSlot
                  ? 'S-B — show the STORYBOARD (live recipe) on this timeline slot (duration setting + current beats + keyframe)'
                  : 'S-B — preview the storyboard (live recipe) in the Clip Monitor (what the next render will use)'
              }
              style={{ width: 54, minHeight: 96, height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>S-B{slotUsesRecipe || (!editingSlot && previewRecipe) ? ' ★' : ''}</span>
              <span style={{ fontSize: 8, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.3 }}>story<br />board</span>
            </span>
            {takes.map((t, i) => {
              const isSel = t.id === slotTakeId
              const dis = !!t.disabled
              return (
                <span
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(MIME_TAKE, JSON.stringify({ clipId: selClip?.id, takeId: t.id }))}
                  onClick={() => {
                    if (editingSlot && editTimelineIndex != null) {
                      // by stable id, through setSlotView — a different-length take ripples what follows
                      const slotId = tlItems[editTimelineIndex]?.id
                      if (slotId) void useStore.getState().setSlotView(slotId, { takeId: t.id })
                    } else if (selClip) {
                      void setKeeper(selClip.id, t.id)
                      useStore.getState().setPreviewRecipe(false) // back to a take view in the Clip Monitor
                    }
                    playTake(t.file)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setTakeCtx({ x: e.clientX, y: e.clientY, takeId: t.id, label: `T${i + 1}` })
                  }}
                  onDoubleClick={() => {
                    // double-click = open THIS take big in the Clip Monitor (its view-only override)
                    useStore.getState().requestMonitorTake(t.id)
                    openClipMonitor()
                  }}
                  title={
                    (dis ? 'DISABLED (skipped by auto-keeper) · ' : '') +
                    (editingSlot ? 'set this take for this timeline slot' : 'click = make keeper · drag to Bin = new clip from this take') +
                    ' · double-click = open in Clip Monitor · right-click = color / disable / AI edit'
                  }
                  style={{
                    width: 118,
                    borderRadius: 7,
                    border: `2px solid ${t.color ?? (isSel ? 'var(--amber)' : 'var(--line2)')}`,
                    background: 'var(--bg2)',
                    padding: 4,
                    cursor: 'pointer',
                    opacity: dis ? 0.45 : 1,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                  }}
                >
                  <Thumbnail videoFile={t.file} scrubVideo={t.file} w={108} h={61} />
                  {dis && (
                    <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.72)', color: 'var(--bad)', fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, letterSpacing: '.06em' }}>
                      OFF
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 11, color: 'var(--txt-hi)' }}>
                    <b>T{i + 1}</b>
                    {isSel && <span style={{ color: 'var(--amber)' }}>★</span>}
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>
                      {t.durationSec ? `${Math.round(t.durationSec * 10) / 10}s` : ''}
                    </span>
                  </span>
                  <span style={{ fontSize: 8.5, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {modelFor(t.engine).label} · {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </span>
              )
            })}
            {takeCtx && selClip && (() => {
              const ctxTake = takes.find((x) => x.id === takeCtx.takeId)
              return (
                <ContextMenu
                  x={takeCtx.x}
                  y={takeCtx.y}
                  entries={[
                    {
                      // swatch row: each square saves its color; the click bubbles to the row and closes the menu
                      label: (
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ color: 'var(--dim)' }}>color</span>
                          {TAKE_COLORS.map((c) => (
                            <span
                              key={c}
                              onClick={() => void useStore.getState().setTakeMeta(selClip.id, takeCtx.takeId, { color: c })}
                              style={{ width: 14, height: 14, borderRadius: 4, background: c, cursor: 'pointer', border: ctxTake?.color === c ? '2px solid var(--txt-hi)' : '1px solid var(--line2)' }}
                            />
                          ))}
                          <span
                            onClick={() => void useStore.getState().setTakeMeta(selClip.id, takeCtx.takeId, { color: null })}
                            title="clear color"
                            style={{ width: 14, height: 14, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--line2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--dim)' }}
                          >
                            ✕
                          </span>
                        </span>
                      )
                    },
                    {
                      label: ctxTake?.disabled ? `✓ enable ${takeCtx.label}` : `⃠ disable ${takeCtx.label} (dud)`,
                      danger: !ctxTake?.disabled,
                      onClick: () => void useStore.getState().setTakeMeta(selClip.id, takeCtx.takeId, { disabled: !ctxTake?.disabled })
                    },
                    { label: '', sep: true },
                    {
                      label: <><Ic i={Wand2} size={12} /> ⑂ edit {takeCtx.label} v2v</>,
                      onClick: () => {
                        useStore.getState().setEditorVideo({ takeRef: { clipId: selClip.id, takeId: takeCtx.takeId } })
                        openVideoEditor()
                      }
                    },
                    { label: '', sep: true },
                    {
                      label: <><Ic i={FolderInput} size={12} /> export {takeCtx.label} video…</>,
                      onClick: async (): Promise<void> => {
                        const r = await window.vidancer.clipExport(selClip.id, takeCtx.takeId)
                        if (r.ok && r.file) toast('exported ✓ — click to show in Explorer', { kind: 'ok', onClick: () => void window.vidancer.revealFile(r.file!) })
                        else if (r.error !== 'cancelled') toast(`export failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
                      }
                    }
                  ]}
                  onClose={() => setTakeCtx(null)}
                />
              )
            })()}
            {takes.length > 0 && selClip && (
              <span
                className="btn vd-hbtn"
                title="edit the ★ take v2v — opens the Video Editor tree on it; keep a result by dragging it out"
                onClick={() => {
                  const tid = slotTakeId ?? selClip.keeperTakeId ?? takes[takes.length - 1].id
                  useStore.getState().setEditorVideo({ takeRef: { clipId: selClip.id, takeId: tid } })
                  openVideoEditor()
                }}
              >
                ⑂ edit
              </span>
            )}
          </div>
        </div>
      ))}

      {sec('setup', 'setup — model · mode · output', <>
      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 auto', ...takeHL('engine') }} onDragOver={takeOver('engine')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('engine', e)}>
          <div className="lb">model</div>
          <select
            value={engine}
            onChange={(e) => {
              const id = e.target.value as EngineId
              setEngine(id)
              // picking an undownloaded local engine KEEPS the selection and fires the wizard
              // (the ScoreCard shape) — the Models card owns the download from there
              if (modelFor(id).provider === 'local' && !ltxSt.renderReady) void modelWizard('ltx-2.5')
            }}
            style={ctl}
            title="generation engine — switching keeps ALL inputs; unsupported ones grey out"
          >
            {/* hidden engines stay out of the picker, EXCEPT the one this clip already uses */}
            {Object.values(MODELS).filter((m) => !m.hidden || m.id === engine).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div style={takeHL('mode')} onDragOver={takeOver('mode')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('mode', e)}>
          <div className="lb">render mode</div>
          <div className="vd-modes">
            {(['ref2v', 'i2v'] as const).map((m) => {
              const supported = model.modes.includes(m)
              return (
                <span
                  key={m}
                  className={'vd-mode' + (mode === m ? ' on' : '')}
                  style={supported ? undefined : { opacity: 0.35, cursor: 'not-allowed' }}
                  title={supported ? undefined : `${model.label} doesn't support ${m}`}
                  onClick={() => supported && switchMode(m)}
                >
                  {m}
                </span>
              )
            })}
          </div>
        </div>
        {model.notes && <div style={{ fontSize: 9, color: 'var(--dim)', paddingBottom: 4 }}>{model.notes}</div>}
      </div>

      <div className="field" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, ...takeHL('duration') }} onDragOver={takeOver('duration')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('duration', e)}>
          <div className="lb">duration</div>
          <select value={duration} onChange={(e) => setDuration(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.durations, duration).map((d) => (<option key={d}>{d}</option>))}
          </select>
        </div>
        <div style={{ flex: 1, ...takeHL('resolution') }} onDragOver={takeOver('resolution')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('resolution', e)}>
          <div className="lb">resolution</div>
          <select value={resolution} onChange={(e) => setResolution(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.resolutions, resolution).map((r) => (<option key={r}>{r}</option>))}
          </select>
        </div>
        <div style={{ flex: 1, ...takeHL('aspect') }} onDragOver={takeOver('aspect')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('aspect', e)}>
          <div className="lb">aspect</div>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.aspectRatios, aspect).map((a) => (<option key={a}>{a}</option>))}
          </select>
        </div>
      </div>

      <div className="field" style={takeHL('audio')} onDragOver={takeOver('audio')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('audio', e)}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: model.audioToggle ? 'pointer' : 'default', opacity: model.audioToggle ? 1 : 0.55 }}>
          <input type="checkbox" checked={model.audioToggle ? audio : true} disabled={!model.audioToggle} onChange={(e) => setAudio(e.target.checked)} />
          <span className="lb" style={{ margin: 0 }}>
            {model.audioToggle ? 'generate audio (native)' : `audio: always on (${model.label})`}
          </span>
        </label>
      </div>
      </>)}

      {sec('prompt', 'prompt & fields', <>
      <div className="field" style={{ position: 'relative' }}>
        <div className="lb" style={{ display: 'flex', alignItems: 'center' }}>
          prompt <span style={{ color: 'var(--dim)' }}>&nbsp;— type @ to insert a ref</span>
          <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '▾ fields' : '▸ fields'}
          </span>
        </div>

        {/* link another clip's prompt — a live, read-only chip; ⇄ flips whether it renders before/after yours */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, position: 'relative', flexWrap: 'wrap' }}>
          {promptLink ? (
            linkedClip ? (
              <>
                <span
                  onDoubleClick={openLinkedClip}
                  title={`double-click → open @${linkedClip.name}\n\n${linkedText ? `@${linkedClip.name}'s prompt (live):\n\n${linkedText}` : `@${linkedClip.name} has no prompt yet`}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 320, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line2)', background: 'var(--raised2)', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 11.5, cursor: 'pointer' }}
                >
                  <Ic i={Link2} size={11} /> @{linkedClip.name}
                  {linkedText && (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160, opacity: 0.6 }}>
                      — {linkedText}
                    </span>
                  )}
                </span>
                <span
                  className="btn vd-hbtn"
                  title="flip: render the linked prompt before / after your own"
                  onClick={() => setPromptLink((l) => (l ? { ...l, pos: l.pos === 'before' ? 'after' : 'before' } : l))}
                >
                  ⇄ {promptLink.pos === 'before' ? 'before yours' : 'after yours'}
                </span>
                <span className="btn vd-hbtn" title="unlink" onClick={() => setPromptLink(null)}>
                  ✕
                </span>
              </>
            ) : (
              <>
                <span style={{ color: 'var(--amber)', fontSize: 11.5, fontFamily: 'var(--mono)' }}><Ic i={Link2} size={11} /> linked clip removed</span>
                <span className="btn vd-hbtn" title="unlink" onClick={() => setPromptLink(null)}>
                  ✕
                </span>
              </>
            )
          ) : (
            <span className="btn vd-hbtn" title="embed another clip's prompt (live)" onClick={() => setLinkPicker((v) => !v)}>
              <Ic i={Link2} size={11} /> link a clip's prompt
            </span>
          )}
          {linkPicker && !promptLink && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 2, minWidth: 220, maxHeight: 220, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
              {(project?.clips ?? []).filter((c) => c.id !== selectedClipId).length === 0 ? (
                <div style={{ padding: '6px 9px', color: 'var(--dim)', fontSize: 12 }}>no other clips</div>
              ) : (
                (project?.clips ?? [])
                  .filter((c) => c.id !== selectedClipId)
                  .map((c) => (
                    <div
                      key={c.id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setPromptLink({ clipId: c.id, pos: 'before' })
                        setLinkPicker(false)
                      }}
                      title={(c.promptData.freeform ?? '').trim() || '(no prompt yet)'}
                      style={{ padding: '5px 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}
                    >
                      <Ic i={Link2} size={11} /> @{c.name}
                    </div>
                  ))
              )}
            </div>
          )}
        </div>

        <textarea
          ref={taRef}
          value={freeform}
          onFocus={freeformFocus.onFocus}
          onChange={(e) => {
            onFreeform(e)
            clearEnhanced('freeform')
          }}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onDragOver={(e) => {
            e.preventDefault()
            if (isTakeDrag(e)) setTakeDrop('prompt')
          }}
          onDragLeave={() => setTakeDrop(null)}
          onDrop={(e) => {
            if (onTakeDrop('prompt', e)) return // T-chip → restore the take's prompt
            onPromptDrop(e)
          }}
          placeholder="your prompt (kept on top, never overwritten) — drag a library image to drop its @name · drag a T-chip to restore a take's prompt"
          rows={3}
          style={{ ...ctl, width: '100%', resize: 'vertical', ...takeHL('prompt'), ...fieldChrome(fieldMeta, 'freeform', freeformFocus.focused) }}
        />
        {mentionMatches.length > 0 && (
          <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, maxHeight: 160, overflow: 'auto' }}>
            {mentionMatches.map((im) => (
              <div
                key={im.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(im.title)
                }}
                style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: 'var(--gold)' }}
              >
                {im.title}
              </div>
            ))}
          </div>
        )}
        {expanded && yamlPreview && (
          <>
            <div className="lb" style={{ marginTop: 8 }}>↓ generated from fields (sent under your prompt)</div>
            <YamlPreview text={yamlPreview} />
          </>
        )}
      </div>

      {expanded && (
        <div style={takeHL('fields')} onDragOver={takeOver('fields')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('fields', e)}>
          <ClipFields
            scene={scene}
            setScene={setScene}
            characters={characters}
            setCharacters={onCharactersChange}
            charLinking={charLinking}
            production={production}
            setProduction={setProduction}
            linking={fieldLinking}
            meta={fieldMeta}
          />
        </div>
      )}
      </>)}

      {sec('beats', 'beats',
      <div style={takeHL('beats')} onDragOver={takeOver('beats')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('beats', e)} title="drag a T-chip here to restore that take's beats (rescaled to the current duration)">
        <Beats
          beats={beats}
          duration={durNum}
          onChange={onBeatsChange}
          refImageUrl={beatRefUrl}
          titles={libImages.map((i) => i.title)}
        />
      </div>
      )}

      {/* images in use for THIS clip — drag from the Library, or use the picker */}
      {sec('refs', isI2v ? 'frames — start / end' : 'references', isI2v ? (
        <div className="field">
          <div style={{ display: 'flex', gap: 10 }}>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                if (isTakeDrag(e)) setTakeDrop('start')
                else setDragTarget('start')
              }}
              onDragLeave={() => {
                setDragTarget(null)
                setTakeDrop(null)
              }}
              onDrop={(e) => {
                if (onTakeDrop('start', e)) return
                onDropImage(e, 'start')
              }}
              style={takeHL('start')}
            >
              <div className="lb">start frame</div>
              {startFile ? (
                <Thumbnail file={startFile} label={titleOf(startFile)} active={dragTarget === 'start'} onClear={() => setStartFile('')} />
              ) : (
                <Thumbnail placeholder="+ set / drag" active={dragTarget === 'start'} onClick={() => setPicker('start')} />
              )}
            </div>
            <div
              onDragOver={(e) => {
                if (!model.endFrame) return
                e.preventDefault()
                if (isTakeDrag(e)) setTakeDrop('end')
                else setDragTarget('end')
              }}
              onDragLeave={() => {
                setDragTarget(null)
                setTakeDrop(null)
              }}
              onDrop={(e) => {
                if (!model.endFrame) return
                if (onTakeDrop('end', e)) return
                onDropImage(e, 'end')
              }}
              style={model.endFrame ? takeHL('end') : { opacity: 0.35, pointerEvents: 'none' }}
              title={model.endFrame ? undefined : `${model.label} has no end frame — kept for other models, not sent`}
            >
              <div className="lb">end frame {model.endFrame ? '(optional)' : `(no ${model.label} support — kept)`}</div>
              {endFile ? (
                <Thumbnail file={endFile} label={titleOf(endFile)} active={dragTarget === 'end'} onClear={() => setEndFile('')} />
              ) : (
                <Thumbnail placeholder="+ set / drag" active={dragTarget === 'end'} onClick={() => setPicker('end')} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="field">
          <div className="lb">
            references in use (@refs, ≤{model.maxRefImages}){' '}
            <span style={{ color: 'var(--dim)' }}>{model.maxRefImages === 0 ? `— ${model.label} refs arrive in a later phase; renders here are text-to-video` : '— yellow = not @mentioned in the prompt'}</span>
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              if (isTakeDrag(e)) setTakeDrop('refs')
              else setDragTarget('ref')
            }}
            onDragLeave={() => {
              setDragTarget(null)
              setTakeDrop(null)
            }}
            onDrop={(e) => {
              if (onTakeDrop('refs', e)) return
              onDropImage(e, 'ref')
            }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, outline: dragTarget === 'ref' || takeDrop === 'refs' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
          >
            {refImages.map((f) => {
              const t = titleOf(f)
              return (
              <Thumbnail
                key={f}
                file={f}
                label={t}
                w={64}
                h={40}
                warn={!t || !mentionedRefs.has(t)}
                onClear={() => {
                  setRefImages((prev) => prev.filter((x) => x !== f))
                  if (t)
                    setFreeform((p) =>
                      p
                        .replace(new RegExp('\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), '')
                        .replace(/\s{2,}/g, ' ')
                        .trim()
                    )
                }}
              />
              )
            })}
            {model.maxRefImages === 0 ? (
              // parked, with the reason (law 4: off-engine controls grey WITH why, never vanish)
              <span className="vd-slot" style={{ opacity: 0.35, cursor: 'not-allowed' }} title={`${model.label} has no reference support yet — it lands in a later phase`}>+ add</span>
            ) : (
              <span className="vd-slot" onClick={() => setPicker('ref')}>+ add</span>
            )}
          </div>
        </div>
      ))}

      {/* ---- Seedance @video refs: positional slots (slot 1 = @video1 on the wire) ---- */}
      {!isI2v && (model.maxRefVideos > 0 || videoRefs.length > 0) && (() => {
        const parked = model.maxRefVideos === 0 // engine can't send them — keep visible, say why (law 4)
        const mentionedLower = new Set([...mentionedRefs].map((s) => s.toLowerCase()))
        const updVref = (i: number, patch: Partial<VideoRef>): void => setVideoRefs((a) => a.map((r, j) => (j === i ? { ...r, ...patch } : r)))
        return (
          <div className="field" style={parked ? { opacity: 0.55 } : undefined}>
            <div className="lb">
              video refs (@video1…, ≤{model.maxRefVideos || '—'} · 2–15s combined)
              <span style={{ color: 'var(--dim)' }}>
                {parked ? ` — no ${model.label} support, kept but NOT sent` : ' — write e.g. "Continue from @video1." in the prompt · yellow = not @mentioned'}
              </span>
            </div>
            <div
              onDragOver={(e) => {
                const t = Array.from(e.dataTransfer.types)
                if (t.includes(MIME_TAKE) || t.includes(MIME_VIDEO)) {
                  e.preventDefault()
                  setTakeDrop('vref')
                }
              }}
              onDragLeave={() => setTakeDrop(null)}
              onDrop={(e) => {
                setTakeDrop(null)
                const vid = e.dataTransfer.getData(MIME_VIDEO)
                if (vid) {
                  e.preventDefault()
                  setVideoRefs((a) => [...a, { videoId: vid }])
                  return
                }
                const tk = e.dataTransfer.getData(MIME_TAKE)
                if (tk) {
                  e.preventDefault()
                  try {
                    const o = JSON.parse(tk) as { clipId?: string; takeId?: string }
                    if (o.clipId && o.takeId) setVideoRefs((a) => [...a, { takeRef: { clipId: o.clipId!, takeId: o.takeId! } }])
                  } catch { /* malformed drag payload — ignore */ }
                }
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', padding: 4, borderRadius: 6, outline: takeDrop === 'vref' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
            >
              {videoRefs.map((r, i) => {
                const info = vrefInfo(r)
                const sec = vrefSec(r)
                const tag = `@video${i + 1}`
                const windowed = r.inSec != null && r.outSec != null
                const trimOpen = trimSlot?.kind === 'v' && trimSlot.i === i
                return (
                  <div key={i} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                    <Thumbnail
                      videoFile={info.file}
                      videoSeek={r.inSec}
                      scrubVideo={info.file}
                      label={`${tag} = ${info.name}${sec != null ? ` · sends ${sec.toFixed(1)}s` : ''} — mention ${tag} in the prompt to bind it`}
                      w={64}
                      h={40}
                      warn={!parked && !mentionedLower.has(tag)}
                      onClear={() => {
                        setVideoRefs((a) => a.filter((_, j) => j !== i))
                        setTrimSlot(null)
                      }}
                    />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: info.file ? 'var(--gold)' : 'var(--bad)', maxWidth: 70, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag}</span>
                    <span
                      className="btn vd-hbtn"
                      style={{ fontSize: 9, ...(windowed ? { color: 'var(--amber)' } : {}) }}
                      title={windowed ? `sends ${r.inSec!.toFixed(1)}–${r.outSec!.toFixed(1)}s of the source — click to change` : 'send only a window of this video (fal caps refs at 15s combined)'}
                      onClick={() => setTrimSlot(trimOpen ? null : { kind: 'v', i })}
                    >
                      ✂ {windowed ? `${(r.outSec! - r.inSec!).toFixed(1)}s` : sec != null ? `${sec.toFixed(1)}s` : '…'}
                    </span>
                    {trimOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, padding: 6, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, display: 'flex', gap: 4, alignItems: 'center', fontSize: 10 }}>
                        <input ref={trimInRef} type="number" min={0} step={0.1} defaultValue={r.inSec ?? 0} style={{ ...ctl, width: 52 }} title="window start (seconds into the source)" />
                        <span style={{ color: 'var(--dim)' }}>→</span>
                        <input ref={trimOutRef} type="number" min={0} step={0.1} defaultValue={r.outSec ?? (info.natSec != null ? Math.min(info.natSec, (r.inSec ?? 0) + 15) : 5)} style={{ ...ctl, width: 52 }} title="window end (seconds into the source)" />
                        <span
                          className="btn vd-hbtn"
                          onClick={() => {
                            const a = parseFloat(trimInRef.current?.value ?? '')
                            let b = parseFloat(trimOutRef.current?.value ?? '')
                            if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) {
                              if (b - a > 15) b = a + 15 // fal's video-ref cap — the window can't exceed the model max
                              updVref(i, { inSec: Math.max(0, a), outSec: b })
                            }
                            setTrimSlot(null)
                          }}
                        >
                          set
                        </span>
                        <span className="btn vd-hbtn" title="send the whole video" onClick={() => { updVref(i, { inSec: undefined, outSec: undefined }); setTrimSlot(null) }}>full</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {!parked && videoRefs.length < model.maxRefVideos && (
                <span style={{ position: 'relative' }}>
                  <span className="vd-slot" onClick={() => (libVideos.length === 0 && !project?.clips.some((c) => c.takes.length > 0) ? openLibraryPanel() : setVidPicker((v) => !v))} title={libVideos.length === 0 && !project?.clips.some((c) => c.takes.length > 0) ? 'no Library videos or takes yet — click opens the Library' : 'add a video reference — pick a Library video or a take (or drag either in)'}>+ add</span>
                  {vidPicker && !(libVideos.length === 0 && !project?.clips.some((c) => c.takes.length > 0)) && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 230, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                      {libVideos.map((v) => (
                        <div key={v.id} onMouseDown={(e) => { e.preventDefault(); setVideoRefs((a) => [...a, { videoId: v.id }]); setVidPicker(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                          🎞 {v.title}{v.durationSec ? ` · ${v.durationSec.toFixed(1)}s` : ''}
                        </div>
                      ))}
                      {(project?.clips ?? []).filter((c) => c.id !== selectedClipId && c.takes.length > 0).map((c) => {
                        const t = c.takes.find((x) => x.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
                        return (
                          <div key={c.id} onMouseDown={(e) => { e.preventDefault(); setVideoRefs((a) => [...a, { takeRef: { clipId: c.id, takeId: t.id } }]); setVidPicker(false) }} title="the clip's keeper take — drag a specific T-chip from its takes row for another" style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                            ▶ {c.name} · keeper{t.durationSec ? ` · ${t.durationSec.toFixed(1)}s` : ''}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {/* ---- Seedance @audio refs: positional slots (need ≥1 image/video ref alongside) ---- */}
      {!isI2v && (model.maxRefAudios > 0 || audioRefs.length > 0) && (() => {
        const parked = model.maxRefAudios === 0
        const mentionedLower = new Set([...mentionedRefs].map((s) => s.toLowerCase()))
        const updAref = (i: number, patch: Partial<AudioRef>): void => setAudioRefs((a) => a.map((r, j) => (j === i ? { ...r, ...patch } : r)))
        return (
          <div className="field" style={parked ? { opacity: 0.55 } : undefined}>
            <div className="lb">
              audio refs (@audio1…, ≤{model.maxRefAudios || '—'} · ≤15s combined)
              <span style={{ color: 'var(--dim)' }}>
                {parked ? ` — no ${model.label} support, kept but NOT sent` : ' — e.g. "Cut the motion to @audio1." · needs ≥1 image/video ref'}
              </span>
            </div>
            <div
              onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types).includes(MIME_AUDIO)) {
                  e.preventDefault()
                  setTakeDrop('aref')
                }
              }}
              onDragLeave={() => setTakeDrop(null)}
              onDrop={(e) => {
                setTakeDrop(null)
                const id = e.dataTransfer.getData(MIME_AUDIO)
                if (!id) return
                e.preventDefault()
                setAudioRefs((a) => [...a, { audioId: id }])
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, outline: takeDrop === 'aref' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
            >
              {audioRefs.map((r, i) => {
                const a = libAudio.find((x) => x.id === r.audioId)
                const sec = arefSec(r)
                const tag = `@audio${i + 1}`
                const windowed = r.inSec != null && r.outSec != null
                const trimOpen = trimSlot?.kind === 'a' && trimSlot.i === i
                const tooLong = !windowed && sec != null && sec > 15
                return (
                  <div key={i} style={{ position: 'relative' }}>
                    <span
                      title={`${tag} = ${a?.title ?? '(deleted track)'}${sec != null ? ` · sends ${sec.toFixed(1)}s` : ''} — mention ${tag} in the prompt to bind it`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 7px', borderRadius: 5, border: '1px solid', borderColor: !parked && !mentionedLower.has(tag) ? 'var(--amber)' : 'var(--line2)', background: 'var(--raised2)', fontSize: 10.5 }}
                    >
                      <span style={{ color: a ? 'var(--amber)' : 'var(--bad)' }}>♪</span>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>{tag}</span>
                      <span style={{ maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: a ? 'var(--body)' : 'var(--bad)' }}>{a?.title ?? '(deleted track)'}</span>
                      <span
                        className="btn vd-hbtn"
                        style={{ fontSize: 9, ...(windowed ? { color: 'var(--amber)' } : tooLong ? { color: 'var(--bad)' } : {}) }}
                        title={windowed ? `sends ${r.inSec!.toFixed(1)}–${r.outSec!.toFixed(1)}s — click to change` : tooLong ? `whole track is ${sec!.toFixed(0)}s — cut a ≤15s window or the render will be blocked` : 'send only a window of this track'}
                        onClick={() => setTrimSlot(trimOpen ? null : { kind: 'a', i })}
                      >
                        ✂ {windowed ? `${(r.outSec! - r.inSec!).toFixed(1)}s` : sec != null ? `${sec.toFixed(1)}s` : '…'}
                      </span>
                      <span style={{ cursor: 'pointer', color: 'var(--dim)', padding: '0 2px' }} onClick={() => { setAudioRefs((x) => x.filter((_, j) => j !== i)); setTrimSlot(null) }}>✕</span>
                    </span>
                    {trimOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, padding: 6, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, display: 'flex', gap: 4, alignItems: 'center', fontSize: 10 }}>
                        <input ref={trimInRef} type="number" min={0} step={0.1} defaultValue={r.inSec ?? 0} style={{ ...ctl, width: 52 }} title="window start (seconds into the track)" />
                        <span style={{ color: 'var(--dim)' }}>→</span>
                        <input ref={trimOutRef} type="number" min={0} step={0.1} defaultValue={r.outSec ?? Math.min((r.inSec ?? 0) + 15, sec ?? 15)} style={{ ...ctl, width: 52 }} title="window end (seconds into the track)" />
                        <span
                          className="btn vd-hbtn"
                          onClick={() => {
                            const x = parseFloat(trimInRef.current?.value ?? '')
                            let y = parseFloat(trimOutRef.current?.value ?? '')
                            if (!Number.isNaN(x) && !Number.isNaN(y) && y > x) {
                              if (y - x > 15) y = x + 15 // fal's audio-ref cap — the window can't exceed the model max
                              updAref(i, { inSec: Math.max(0, x), outSec: y })
                            }
                            setTrimSlot(null)
                          }}
                        >
                          set
                        </span>
                        <span className="btn vd-hbtn" title="send the whole track" onClick={() => { updAref(i, { inSec: undefined, outSec: undefined }); setTrimSlot(null) }}>full</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {!parked && audioRefs.length < model.maxRefAudios && (
                <span style={{ position: 'relative' }}>
                  <span className="vd-slot" onClick={() => (libAudio.length ? setAudPicker((v) => !v) : openLibraryPanel())} title={libAudio.length ? 'add an audio reference — pick a Library music track (or drag one in)' : 'no Library music yet — click opens the Library'}>+ add</span>
                  {audPicker && libAudio.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 200, maxHeight: 200, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                      {libAudio.map((a) => (
                        <div key={a.id} onMouseDown={(e) => { e.preventDefault(); setAudioRefs((x) => [...x, { audioId: a.id }]); setAudPicker(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                          ♪ {a.title}{a.durationSec ? ` · ${a.durationSec.toFixed(0)}s` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {(lint.length > 0 || check.errors.length > 0 || check.warnings.length > 0) && (
        <div className="field" style={{ fontSize: 10 }}>
          {check.errors.map((w, i) => (
            <div key={'e' + i} style={{ color: 'var(--bad)' }}>✕ {w}</div>
          ))}
          {check.warnings.map((w, i) => (
            <div key={'c' + i} style={{ color: 'var(--amber)' }}>⚠ {w}</div>
          ))}
          {lint.map((w, i) => (
            <div key={'l' + i} style={{ color: 'var(--amber)' }}>⚠ {w}</div>
          ))}
        </div>
      )}
      </div>

      {/* sticky footer — the render action + live status stay visible no matter how long the form gets */}
      <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--line)', padding: '8px 10px', background: 'var(--bg2)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span
            className="btn"
            title={
              check.errors.length
                ? 'fix the ✕ items above first'
                : estStr
                  ? `estimated fal cost: ${resolution}${duration === 'auto' ? ', auto duration assumed 5s' : ` × ${durNum}s`} @ $${rate.toFixed(4)}/s (${model.label}, standard tier). Actual may vary.`
                  : undefined
            }
            style={{
              flex: 1,
              textAlign: 'center',
              opacity: check.errors.length ? 0.5 : 1
            }}
            onClick={() => submitRender('now')}
          >
            {`${selectedClipId ? '▶ Render now (adds a take)' : '▶ Render now (new clip)'} · ${model.label}${estStr ? ' · ' + estStr : ''}`}
          </span>
          <span
            className="btn"
            title={check.errors.length ? 'fix the ✕ items above first' : 'add to the render queue — runs in order, one at a time'}
            style={{ flex: '0 0 auto', textAlign: 'center', opacity: check.errors.length ? 0.5 : 1 }}
            onClick={() => submitRender('queue')}
          >
            ＋ Queue
          </span>
        </div>
        <p className="vd-hint" style={{ margin: '5px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: status.startsWith('error') ? 'var(--bad)' : 'var(--muted)' }} title={status}>
          {status}
        </p>
      </div>

      {preview &&
        createPortal(
          <div
            onClick={closePreview}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.88)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span onClick={closePreview} style={{ position: 'absolute', top: 12, right: 18, color: '#fff', fontSize: 26, cursor: 'pointer' }}>✕</span>
            <video
              src={preview}
              controls
              autoPlay
              loop
              onPlay={(e) => focusAudio(e.currentTarget)}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, background: '#000' }}
            />
          </div>,
          document.body
        )}

      {picker &&
        createPortal(
          <div
            onClick={() => setPicker(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: 16, width: 'min(640px, 86vw)', maxHeight: '80vh', overflow: 'auto' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <span className="lb" style={{ margin: 0 }}>pick image — {picker === 'ref' ? 'reference' : picker + ' frame'}</span>
                <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void pickerImport()}><Ic i={ImageDown} size={11} /> import new</span>
                <span style={{ marginLeft: 10, cursor: 'pointer', color: 'var(--dim)' }} onClick={() => setPicker(null)}>✕</span>
              </div>
              {libImages.length === 0 && <p className="vd-hint">Library is empty — import one.</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {libImages.map((im) => (
                  <Thumbnail key={im.id} file={im.file} label={im.title} w={104} h={66} onClick={() => assign(im.file)} />
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
