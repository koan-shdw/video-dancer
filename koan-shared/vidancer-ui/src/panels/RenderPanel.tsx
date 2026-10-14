import { vd } from '../api'
import { loraFamilyOf } from '../shared/loraFamilies'
import { imageAssetIdForFile } from '../shared/imageSources'
import { EmptyState } from '../ui/EmptyState'
import { FloatPick } from '../ui/FloatPick'
import { Section, Dropdown, aspectLabel, type DropdownOption } from '@koan/shared'
import { LoraChips } from '../ui/LoraChips'
import { LoraSidebar, LORA_FAMILIES, useFolderLoras } from './ImageGenSidebar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { mentionMatches as mentionMatchesOf, disabledLast, dimStyle } from '../lib/disabledItems'
import { ClipFields, useFieldFocus, fieldChrome } from './ClipFields'
import { Beats, fitArr } from './Beats'
import { Thumbnail } from '../Thumbnail'
import { mediaUrl } from '../media'
import { focusAudio, muteAll, subAudio } from '../audioBus'
import { buildYaml, buildNatural, buildProse, buildSeedance25, buildCombinedFor, applyRefTags, applyVideoRefTags, lintFields, preflightClip, readLinkSource, resolveCharLinkSource, resolveEffective, EMPTY_SCENE, EMPTY_PRODUCTION, beatRefFile, beatRanges, BEAT_COLORS } from '../emitYaml'
import { smpte } from '../lib/time'
import { exportEntry } from '../lib/exportEntry'
import { arrowNav } from '../lib/arrowNav'
import { isKeeper } from '../shared/keepers'
import { KeeperStar, KeepersOnlySwitch, keeperEntries, toggleKeepers, useKeepersOnly } from '../lib/keeperUi'
import { framePngBytes } from '../lib/frameGrab'
import { modelFor, DEFAULT_ENGINE } from '../shared/models'
import { validateForm } from '../lib/validation'
import { MIME_IMAGE, MIME_TAKE, MIME_VIDEO, MIME_AUDIO, MIME_VOICE } from '../lib/dragDrop'
import { audioRefSec, roleOf, dialogueLock, dialogueSlots, slotSpeaker, dialogueText, type AudioRole } from '../shared/compile'
import { audioModelFor, VOICE_CHAR_RATE } from '../shared/audioModels'
import { activeItems } from '../lib/timelineUtils'
import { ctl } from '../ui/controls'
import { toast } from '../ui/Toast'
import { openProjectStyles, openVideoEditor, openImageEditor, openClipMonitor, openLibraryPanel, openVoicesCard, setClipGenPlayToggle, setClipGenMarkInOut } from '../panelBus'
import { Ic, ScoreIcon, Link2, ImageDown, Play, Pause, Volume2, VolumeX, Maximize2, Wand2, FolderInput, ChevronUp, ChevronDown, Trash2 } from '../ui/icons'
import { confirmDialog } from '../prompt'
import { ContextMenu } from '@koan/shared'
import { ResizeHandle } from '../ui/ResizeHandle'
import { modelWizard } from '../lib/modelWizard'
import { useLtxReady } from '../lib/ltxReady'
import { useH3Ready, h3GateReason } from '../lib/h3Ready'
import { H3_SET_DEFAULT } from '../shared/models'
import type { H3LoraSet } from '../shared/types'
import { draftLeftMs, DRAFT_DAYS } from '../shared/types'
import { encodeEngine, decodeEngine, missingPinOption, modelOptions, viaOptions, familyOf, isFamily, engineForFamily, rememberVia } from '../lib/engineOptions'
import { tetherAttr } from '../lib/tether'
import { buildBlockingPrompt } from '../shared/blocking'
import { localModelFor } from '../shared/localModels'
import { enhanceTone, enhanceWords } from '../shared/enhance'
import { depthLabel, DEPTH_TITLE, queueDepth } from '../lib/depthJob'
import { useTakeMultiSelect } from '../lib/takeSelection'
import { registerFire, type FireResult } from '../lib/codirFire'

// take-card highlight palette (right-click a take card) — fixed set so colors stay meaningful
const TAKE_COLORS = ['#e05656', '#e09b3d', '#d8c93a', '#4fae5c', '#3d8fd6', '#9b6ad6']

// keep the stored value selectable even when the active engine doesn't list it — the value is
// preserved (store-everything), validation flags it, and switching engines back restores validity
const withCurrent = (options: string[], current: string): string[] =>
  options.includes(current) ? options : [current, ...options]

// the "generated from fields" preview with a Ctrl+F find (docs/archive/YAML-FIND-SPEC-2026-08-26.md):
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
      if (document.querySelector('[aria-modal="true"]')) return
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
  const importPaths = useStore((s) => s.importPaths)
  const [keepersOnly, setKeepersOnly] = useKeepersOnly('clipgen') // list 6: ★ only
  const editTimelineIndex = useStore((s) => s.editTimelineIndex)
  const createClip = useStore((s) => s.createClip)
  const saveClipPromptData = useStore((s) => s.saveClipPromptData)
  const autoTime = useStore((s) => s.autoTime)
  const renameSignal = useStore((s) => s.renameSignal)
  const fileSwap = useStore((s) => s.fileSwap)
  const undoTick = useStore((s) => s.undoTick)

  const [clipName, setClipName] = useState('')
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE)
  // the pinned local size (bible 12.9) — rides the clip's promptData; absent = best installed
  const [ltxSize, setLtxSize] = useState<string | undefined>(undefined)
  // local-engine readiness — the shared lib/ltxReady cache (a DISTILLED LTX size on disk =
  // renderable; full/dev bf16 alone is not — its sampling recipe is unprobed, LTX-SPEC §9.1)
  const ltxSt = useLtxReady()
  const h3St = useH3Ready()
  // MiniMax H3 local dials (MINIMAX-H3-LOCAL-SPEC §3 / §4.4) — ride the clip's promptData like ltxSize
  const [h3Encoder, setH3Encoder] = useState<string | undefined>(undefined)
  const [h3Upscale, setH3Upscale] = useState(true)
  const [h3UpscaleBy, setH3UpscaleBy] = useState<number>(1.25)
  const [h3Kernels, setH3Kernels] = useState<'off' | 'sage' | 'sol'>('off')
  const [h3Set, setH3Set] = useState<H3LoraSet>(H3_SET_DEFAULT)
  const isLocal = engine === 'ltx25' || engine === 'h3local' // the local engines share seed / lora wires
  // the lora block + side panel (MINIMAX-H3-LOCAL-SPEC §4): Image Gen's grammar, local engines only
  const [loraOn, setLoraOn] = useState(true)
  const [sideOpen, setSideOpen] = useState(true)
  const [sideW, setSideW] = useState(260)
  const folderRows = useFolderLoras()
  const [mode, setMode] = useState<'ref2v' | 'i2v' | 't2v'>('ref2v')
  const [freeform, setFreeform] = useState('')
  const [negative, setNegative] = useState('') // real only on the bf16 pick; kept (store-everything) when greyed
  const [loras, setLoras] = useState<{ name: string; weight: number }[]>([]) // shelf picks (spec §7) — LTX only, kept when greyed; picker UI = @koan/shared LoraPicker
  // one picks list for both local engines: a pick of the OTHER family (LTX picks after a switch to H3,
  // and back) stays parked and is never sent; an untagged one fits both, as the side panel lists it
  // (the side panel's rule, loraFamilyOf) (audit 2026-10-09 L35)
  const [loraFolders, setLoraFolders] = useState<LoraFolder[]>([])
  useEffect(() => void vd().imageGenFolders().then(setLoraFolders), [folderRows])
  const loraFits = (name: string): boolean => {
    const row = folderRows.find((r) => r.rel === name)
    const fam = row ? loraFamilyOf(row, loraFolders) : undefined
    return !fam || fam === (engine === 'h3local' ? 'h3' : 'ltx')
  }
  const liveLoras = loras.filter((l) => loraFits(l.name))
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
  const [draft, setDraft] = useState(false) // list 17: Seedance 2.5's Draft switch (kept with the clip; only that engine reads it)
  const [aspect, setAspect] = useState('auto')
  const [audio, setAudio] = useState(true)
  const [seed, setSeed] = useState('0') // '0' = random (LTX-only dial; string keeps typing loose)
  const [loadedClipId, setLoadedClipId] = useState<string | null>(null) // the clip the form holds right now (set with the form, in one batch)
  const [status, setStatus] = useState('idle')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const loadingRef = useRef(false) // true while populating the form from a clip → suppress auto-save
  const beatsDirtyRef = useRef(false) // true when beats were edited HERE since load → only then persist them
  const lastSavedBeatsRef = useRef<string | null>(null) // JSON of the beats THIS panel last loaded/saved — detects EXTERNAL writers
  const adoptRef = useRef(false) // '+ new' adopted typed content → the next load KEEPS the form (no wipe)
  const projDirRef = useRef<string | undefined>(undefined) // which project the form's content belongs to
  const formClipRef = useRef<string | null>(null) // the clip the form was last filled from
  const loadedRef = useRef<Record<string, string> | null>(null) // that clip's recipe as last loaded/saved, per field (JSON)
  const pendingSaveRef = useRef<(() => void) | null>(null) // the autosave waiting out its 600 ms
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
  const [takeCtx, setTakeCtx] = useState<{ x: number; y: number; takeId: string; takeIds: string[]; label: string } | null>(null) // T-chip right-click → edit that take (v2v)
  const [pvCtx, setPvCtx] = useState<{ x: number; y: number } | null>(null) // preview right-click → frame grab (the timeline monitor's sibling)
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
  const isT2v = mode === 't2v' // words only — refs park in the UI, the wire gets ref2v with zero refs
  const model = modelFor(engine) // the active engine's capability descriptor drives the fields below
  // list 17: a Draft is a 480p render whatever the dial says; the dial keeps its pick for when the switch goes off
  const isDraft = !!model.draft && draft
  const renderRes = isDraft ? '480p' : resolution
  const libImages = project?.images ?? []
  const titleOf = (file: string): string | undefined => libImages.find((i) => i.file === file)?.title
  const fileOfTitle = (title: string): string | undefined => libImages.find((i) => i.title === title)?.file
  const libVideos = project?.videos ?? []
  const libAudio = project?.audio ?? []
  const voiceClips = project?.voiceClips ?? [] // list 44: a Bin voice is an @audio slot too (its playing take sends)
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
  const arefSec = (r: AudioRef): number | undefined => audioRefSec(project, r) // a voice slot: its playing take's length

  // a clip can live-embed ONE other clip's prompt: the linked clip's CURRENT freeform is spliced
  // before/after our own at render. Resolved by id → renames are safe, a deleted clip just drops out.
  const linkedClip = promptLink ? project?.clips.find((c) => c.id === promptLink.clipId) : undefined
  const linkedText = (linkedClip?.promptData.freeform ?? '').trim() // chip UI only — the splice itself lives in resolveEffective
  // the WHOLE cascade (field link stacks minus overrides, char links, promptLink splice) resolves
  // in SHARED code — the same compile the Co-Director's read_compiled_prompt reads
  // (docs/COMPILED-PROMPT-SPEC-2026-08-27.md). The panel feeds its LIVE form state, so unsaved
  // edits preview exactly as before.
  const projStyles = project?.styles ?? []
  const readSource = (id: string, path: string): string => readLinkSource(project, id, path)
  const resolveCharLink = (l: CharacterLink): CharacterField | undefined => resolveCharLinkSource(project, l)
  const structured = { scene, characters, beats, production, duration } // local (what you typed) — drives lint
  const { effectiveFreeform, effectiveStructured } = resolveEffective(project, {
    freeform,
    scene,
    characters,
    beats,
    production,
    duration,
    imageIds: refImages.map((f) => project?.images.find((i) => i.file === f)?.id).filter((x): x is string => !!x), // sheet law (bible 12.8)
    promptLink: promptLink ?? undefined,
    fieldLinks,
    fieldOverrides,
    characterLinks: charLinks,
    voiceRefs: !isI2v && !isT2v && model.maxRefAudios > 0 ? audioRefs : undefined // list 44: each sent voice slot's role line
  })
  // emit in the ACTIVE engine's flavor — lint, mention warnings and the preview must all judge the
  // prompt that will actually be sent, not a Seedance YAML the model never sees
  // ▤ block — the story-blocking sheet (shared/blocking.ts): warn on fights (his rule), then main
  // draws it on Nano, files it under Library/blocking and attaches it LAST as staging-only
  const [blockBusy, setBlockBusy] = useState(false)
  const blockScene = async (): Promise<void> => {
    if (!selectedClipId) return void toast('save the clip first — the sheet attaches to a Bin clip', { kind: 'error' })
    const plan = buildBlockingPrompt({ clipName: clipName || 'clip', beats, durationSec: Number(duration) || 0, aspect })
    if (!plan.panels.length) return void toast('write the beats first — the sheet is drawn from them', { kind: 'error' })
    if (plan.fight && !(await confirmDialog(`${plan.fightWhy}.\n\nDraw it anyway?`, { confirmLabel: 'block anyway', danger: true }))) return
    setBlockBusy(true)
    try {
      const r = await vd().blockBuild(selectedClipId)
      if (!r.ok) return void toast(`block: ${r.error ?? 'failed'}`, { kind: 'error' })
      if (r.delta) useStore.getState().applyDelta(r.delta)
      useStore.setState((s) => ({ undoTick: s.undoTick + 1 })) // the refs row reloads with the sheet attached last
      toast(`blocking sheet drawn — ${r.panels} panels, attached last (Library → blocking)`, { kind: 'ok' })
    } finally {
      setBlockBusy(false)
    }
  }
  const promptStyle = modelFor(engine).promptStyle ?? 'yaml'
  // Seedance 2.5 extras: the attached refs (for [Reference Roles]) + the aspect when set
  const sd25Extras = { refs: refImages.map((f) => ({ title: titleOf(f) ?? '', sheet: !!libImages.find((i) => i.file === f)?.sheet, blocking: !!libImages.find((i) => i.file === f)?.blocking })), aspect }
  const yamlPreview = promptStyle === 'seedance25' ? buildSeedance25(effectiveStructured, sd25Extras) : promptStyle === 'prose' ? buildProse(effectiveStructured) : promptStyle === 'natural' ? buildNatural(effectiveStructured) : buildYaml(effectiveStructured)
  const combined = buildCombinedFor(promptStyle, effectiveFreeform, effectiveStructured, sd25Extras)
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
      // a disabled style / clip lists dimmed at the END of its group (DISABLE-ITEMS-SPEC)
      ...disabledLast(projStyles).map((s) => ({ id: s.id, name: s.name, kind: 'style' as const, disabled: s.disabled })),
      ...disabledLast((project?.clips ?? []).filter((c) => c.id !== selectedClipId)).map((c) => ({ id: c.id, name: c.name, kind: 'clip' as const, disabled: c.disabled }))
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
      ...disabledLast(project?.charSheets ?? []).map((s) => ({ clipId: s.id, clipName: `⛉ ${s.name}`, charName: s.character.name || s.name, disabled: s.disabled })),
      ...disabledLast((project?.clips ?? []).filter((c) => c.id !== selectedClipId)).flatMap((c) =>
        c.promptData.characters.filter((ch) => ch.name.trim()).map((ch) => ({ clipId: c.id, clipName: c.name, charName: ch.name, disabled: c.disabled }))
      )
    ],
    add: (l: CharacterLink): void => {
      setCharLinks((ls) => (ls.some((x) => x.clipId === l.clipId && x.charName === l.charName) ? ls : [...ls, l]))
      joinRefTitle(resolveCharLink(l)?.referenceLabel) // the source's ref image rides along into this clip's refs
      // list 44: a sheet bound to a voice brings that voice as an @audio slot, tagged with the sheet
      const sh = project?.charSheets?.find((x) => x.id === l.clipId)
      if (sh?.voiceId && voiceClips.some((v) => v.id === sh.voiceId) && !audioRefs.some((r) => r.fromSheetId === sh.id)) {
        if (audioRefs.length >= 3) toast(`the audio refs are full (3), so ${sh.name}'s voice was not added`, { kind: 'error' })
        else setAudioRefs((a) => [...a, { voiceId: sh.voiceId!, fromSheetId: sh.id }])
      }
    },
    remove: (l: CharacterLink): void => {
      setCharLinks((ls) => ls.filter((x) => !(x.clipId === l.clipId && x.charName === l.charName)))
      setAudioRefs((a) => (a.some((r) => r.fromSheetId === l.clipId) ? a.filter((r) => r.fromSheetId !== l.clipId) : a)) // list 44: its voice slot goes with it
    },
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
      resolution: renderRes,
      aspect,
      videoRefCount: videoRefs.length,
      audioRefCount: audioRefs.length,
      videoRefTotalSec: videoSecs.some((x) => x == null) ? undefined : videoSecs.reduce((s: number, x) => s + (x ?? 0), 0),
      videoRefSecs: videoSecs,
      audioRefTotalSec: audioSecs.some((x) => x == null) ? undefined : audioSecs.reduce((s: number, x) => s + (x ?? 0), 0),
      audioRefSecs: audioSecs
    },
    model
  )
  // local-engine gate — the reason lands BEFORE the click (gating law), never a failed render
  if (engine === 'h3local') {
    const why = h3GateReason(h3St)
    if (why) check.errors.push(why)
  } else if (model.provider === 'local' && !ltxSt.renderReady) {
    check.errors.push('LTX is not installed — pick a size in the Models card')
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
  // (list 23: a talking still is as long as its voice, and a long one costs more a second)
  const talkSec = model.talkingStill ? (audioSecs[0] ?? 0) : null
  const durNum = talkSec != null ? talkSec : duration === 'auto' ? 5 : parseFloat(duration) || 0
  const rate = model.pricePerSec[renderRes] ?? Object.values(model.pricePerSec)[0] ?? 0
  const estCost = rate * durNum * (model.talkingStill?.over && durNum > model.talkingStill.over.sec ? model.talkingStill.over.mult : 1)
  // cost-honesty law: a local engine has no honest $/s — the estimate says what it is instead
  const estStr = model.provider === 'local' ? 'local render' : estCost > 0 ? `~$${estCost.toFixed(2)}${duration === 'auto' && talkSec == null ? '*' : ''}` : ''

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
  // right-click frame grab on the take preview (user order 2026-09-01) — the timeline monitor's
  // sibling: current frame → Library image, and (ref2v) straight into this clip's image refs
  const grabPreviewFrame = async (mode: 'ref' | 'lib'): Promise<void> => {
    const v = previewRef.current
    if (!v || !v.src) return
    const bytes = await framePngBytes(v)
    if (!bytes) {
      setStatus('no frame to grab')
      return
    }
    const note = `frame · ${selClip?.name ?? (clipName || 'clip')} · ${smpte(v.currentTime)}`
    const id = await useStore.getState().saveFrame(bytes, note)
    const img = id ? useStore.getState().project?.images.find((i) => i.id === id) : undefined
    if (!img) {
      setStatus('frame grab failed')
      return
    }
    if (mode === 'ref' && !isI2v) addRef(img.file) // joins the refs AND drops its @name into the prompt
    setStatus(mode === 'ref' && !isI2v ? `✓ ${img.title} → Library + image refs` : `✓ ${img.title} → Library`)
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
    if (!(job.payload as RenderArgs).clipId && job.resultClipId) {
      // brand-new clip → select it. The form still holds what he typed while it rendered: the new clip
      // ADOPTS the form (the '+ new' path), it never loads its render-time recipe over it (audit 2026-10-09 H16)
      if (!useStore.getState().selectedClipId) adoptRef.current = true
      selectClip(job.resultClipId)
    }
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

  // ONE form fill from a recipe (audit 2026-10-09): a clip's load, a take's recipe (↩ load Tn) and the
  // empty form after a project switch all go through it, so nothing is left over from before (L31),
  // and the seed and the links come back with the rest (M36, M37). `keep` = this clip's recipe as the
  // form last loaded or saved it: a reload of the SAME clip (a Co-Director write, an undo) takes only
  // the fields that changed in the store since, never the ones he is typing (M3).
  const fillForm = (pd: Partial<PromptData> & { prompt?: string }, keep?: Record<string, string> | null): void => {
    const take = (...keys: string[]): boolean => !keep || keys.some((k) => keep[k] !== JSON.stringify((pd as Record<string, unknown>)[k] ?? null))
    const fileOfId = (id?: string): string | undefined => (id ? useStore.getState().project?.images.find((i) => i.id === id)?.file : undefined)
    if (take('engine')) setEngine(pd.engine ?? DEFAULT_ENGINE)
    if (take('ltxSize')) setLtxSize(pd.ltxSize)
    if (take('h3Encoder')) setH3Encoder(pd.h3Encoder)
    if (take('h3Upscale')) setH3Upscale(pd.h3Upscale ?? true)
    if (take('h3UpscaleBy')) setH3UpscaleBy(pd.h3UpscaleBy ?? 1.25)
    if (take('h3Kernels')) setH3Kernels(pd.h3Kernels ?? 'off')
    if (take('h3Set')) setH3Set(pd.h3Set ?? H3_SET_DEFAULT)
    if (take('mode')) setMode(!pd.mode || pd.mode === 'v2v' ? 'ref2v' : pd.mode) // edit clips belong to the Video Editor — never render them as v2v from here
    if (take('freeform')) setFreeform(pd.freeform ?? pd.prompt ?? '') // (a legacy `prompt` is only a fallback, never a change)
    if (take('negative')) setNegative(pd.negative ?? '')
    if (take('loras')) setLoras(pd.loras ?? [])
    if (take('loraOn')) setLoraOn(pd.loraOn ?? true)
    if (take('seed')) setSeed(String(pd.seed ?? 0))
    if (take('scene')) setScene(pd.scene ?? { ...EMPTY_SCENE })
    if (take('characters')) setCharacters(pd.characters ?? [])
    if (!keep) setBeats(pd.beats ?? []) // a same-clip reload leaves beats to the storeBeats effect below
    if (take('production')) setProduction(pd.production ?? { ...EMPTY_PRODUCTION })
    if (take('duration')) setDuration(pd.duration ?? '5')
    if (take('resolution')) setResolution(pd.resolution ?? '720p')
    if (take('draft')) setDraft(!!pd.draft)
    if (take('aspectRatio')) setAspect(pd.aspectRatio ?? 'auto')
    if (take('generateAudio')) setAudio(pd.generateAudio ?? true)
    if (take('promptLink')) setPromptLink(pd.promptLink ?? null)
    if (take('fieldLinks')) {
      // disk migration wraps pre-v6 single-id links; normalize here too so a stray string can't crash the stack UI
      const fl: Record<string, string[]> = {}
      for (const [lp, v] of Object.entries(pd.fieldLinks ?? {})) {
        const stack = (Array.isArray(v) ? v : [v as unknown as string]).filter((x): x is string => typeof x === 'string' && !!x)
        if (stack.length) fl[lp] = stack
      }
      setFieldLinks(fl)
    }
    if (take('fieldOverrides')) setFieldOverrides(pd.fieldOverrides ?? {})
    if (take('characterLinks')) setCharLinks(pd.characterLinks ?? [])
    if (take('enhanced')) setEnhancedPaths(pd.enhanced ?? [])
    if (take('videoRefs')) setVideoRefs(pd.videoRefs ?? [])
    if (take('audioRefs')) setAudioRefs(pd.audioRefs ?? [])
    if (take('mode', 'imageIds', 'endImageId')) {
      if (pd.mode === 'i2v') {
        const fs = (pd.imageIds ?? []).map(fileOfId).filter((f): f is string => Boolean(f))
        setStartFile(fs[0] ?? '')
        setEndFile(fileOfId(pd.endImageId) ?? '')
        setRefImages([])
      } else {
        setRefImages(Array.from(new Set((pd.imageIds ?? []).map(fileOfId).filter((f): f is string => Boolean(f))))) // heal stored dupes on load
        setStartFile('')
        setEndFile('')
      }
    }
  }
  // what the form compares a same-clip reload against: the recipe per field, as JSON
  const RECIPE_KEYS = ['engine', 'ltxSize', 'h3Encoder', 'h3Upscale', 'h3UpscaleBy', 'h3Kernels', 'h3Set', 'mode', 'freeform', 'negative', 'loras', 'loraOn', 'seed', 'scene', 'characters', 'production', 'duration', 'resolution', 'draft', 'aspectRatio', 'generateAudio', 'promptLink', 'fieldLinks', 'fieldOverrides', 'characterLinks', 'enhanced', 'videoRefs', 'audioRefs', 'imageIds', 'endImageId']
  const recipeKeys = (pd: object, name: string): Record<string, string> => ({ ...Object.fromEntries(RECIPE_KEYS.map((k) => [k, JSON.stringify((pd as Record<string, unknown>)[k] ?? null)])), __name: name })

  useEffect(() => {
    if (!selectedClipId || !project) {
      formClipRef.current = null // whatever is typed now is no clip's: a later pick loads it fresh
      return
    }
    const c = project.clips.find((x) => x.id === selectedClipId)
    if (!c) return
    setLoadedClipId(c.id)
    const pd = c.promptData as PromptData & { prompt?: string }
    if (adoptRef.current) {
      // '+ new' (or a new clip's render landing) just adopted the user's typed content into this fresh
      // clip — KEEP the form exactly as typed (the autosave persists it); loading the blank clip over
      // it was the lost-work bug. The typed beats go too, never the new clip's empty ones (audit
      // 2026-10-09 M43): ours to send, and the new clip's beats are no outside write.
      adoptRef.current = false
      beatsDirtyRef.current = true
      lastSavedBeatsRef.current = JSON.stringify(pd.beats ?? [])
      formClipRef.current = c.id
      loadedRef.current = recipeKeys(pd, c.name)
      setStatus(`added to bin${clipName.trim() ? ': ' + clipName.trim() : ''}`)
      return
    }
    const keep = formClipRef.current === c.id ? loadedRef.current : null
    formClipRef.current = c.id
    if (!keep) {
      loadingRef.current = true // suppress auto-save while we populate from the clip
      beatsDirtyRef.current = false // freshly loaded → beats not locally edited yet
      lastSavedBeatsRef.current = JSON.stringify(pd.beats ?? []) // baseline for external-writer detection
      setLinkPicker(false)
    }
    if (!keep || keep.__name !== c.name) setClipName(c.name)
    fillForm(pd, keep)
    loadedRef.current = recipeKeys(pd, c.name)
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
    // (undoTick is included so undo/redo and Co-Director writes reach the live form: as a same-clip
    // reload, field by field, so typing in progress stays)
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
    const dropped = e.dataTransfer.getData(MIME_IMAGE)
    if (!dropped) return
    const place = (f: string): void => {
      if (target === 'start') setStartFile(f)
      else if (target === 'end') setEndFile(f)
      else addRef(f)
    }
    if (idOfFile(dropped)) return place(dropped)
    // a file from outside the Library (a Watched tile) joins it first: a slot holding an outside path
    // was never saved to the clip and had no @name (audit 2026-10-09 M41)
    void importPaths([dropped]).then((ids) => {
      const f = ids[0] ? useStore.getState().project?.images.find((i) => i.id === ids[0])?.file : undefined
      if (f) place(f)
    })
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
    ? mentionMatchesOf(libImages, mention.query)
    : []

  // project switched with nothing selected → the form still holds the PREVIOUS project's content;
  // clear it so '+ new' can't adopt leftovers into the wrong project
  useEffect(() => {
    if (project?.dir === projDirRef.current) return
    projDirRef.current = project?.dir
    if (selectedClipId) return // a real selection will load over the form anyway
    // EVERY field, through the one fill: refs, links, LoRAs and dials of the old project went with it
    // before (audit 2026-10-09 L31)
    formClipRef.current = null
    loadedRef.current = null
    setClipName('')
    fillForm({})
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
  // carry images across a mode toggle so flipping modes never silently drops frames
  const switchMode = (m: 'ref2v' | 'i2v' | 't2v'): void => {
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

  const idOfFile = (f: string): string | undefined => {
    const p = useStore.getState().project
    return p ? imageAssetIdForFile(p, f) : undefined
  }
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
      draft: draft || undefined,
      aspectRatio: aspect,
      generateAudio: audio,
      ltxSize,
      h3Encoder,
      h3Upscale,
      h3UpscaleBy,
      h3Kernels,
      h3Set,
      negative: negative.trim() || undefined,
      loras: loras.length ? loras : undefined,
      loraOn,
      seed: Number(seed) > 0 ? Number(seed) : undefined, // the clip keeps its seed (audit 2026-10-09 M36)
      promptLink: promptLink ?? undefined,
      fieldLinks: Object.keys(fieldLinks).length ? fieldLinks : undefined,
      fieldOverrides: Object.keys(fieldOverrides).length ? fieldOverrides : undefined,
      characterLinks: charLinks.length ? charLinks : undefined,
      enhanced: enhancedPaths.length ? enhancedPaths : undefined
    }
  }
  // list 31: the preflight of what THIS form would send — the same check the Co-Director reads
  // (read_compiled_prompt) and gets back when it fires the clip
  const flags = preflightClip(project, buildPromptData(), { autoTime })
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
    const fire = (): void => {
      pendingSaveRef.current = null
      if (sentBeats && payload.beats) lastSavedBeatsRef.current = JSON.stringify(payload.beats) // OUR write — its echo isn't "external"
      // OUR write: its echo is no outside change for a same-clip reload to take
      if (loadedRef.current && formClipRef.current === id) Object.assign(loadedRef.current, recipeKeys(payload, loadedRef.current.__name))
      void saveClipPromptData(id, payload)
      if (sentBeats) beatsDirtyRef.current = false
    }
    pendingSaveRef.current = fire
    const t = window.setTimeout(fire, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, ltxSize, h3Encoder, h3Upscale, h3UpscaleBy, h3Kernels, h3Set, mode, freeform, negative, loras, loraOn, seed, scene, characters, charLinks, beats, production, refImages, videoRefs, audioRefs, startFile, endFile, duration, resolution, draft, aspect, audio, promptLink, fieldLinks, fieldOverrides, enhancedPaths, selectedClipId])
  // the last edit goes out when the clip changes or the panel closes — it used to be dropped when he
  // picked another clip within 600 ms (audit 2026-10-09 M3)
  useEffect(() => () => pendingSaveRef.current?.(), [selectedClipId])

  const submitRender = (lane: 'queue' | 'now'): string => {
    const say = (line: string): string => {
      setStatus(line)
      return line
    }
    if (check.errors.length) return say('fix first: ' + check.errors[0])
    // `combined` is already in this engine's flavor — only the ref-tag rewrite is outgoing-only
    // (the visible prompt keeps @titles; the wire prompt binds refs as <IMAGE_REF_n>)
    const m = modelFor(engine)
    let outPrompt = combined
    // t2v parks the refs (none is sent), so the @names stay words (audit 2026-10-09 L30)
    if (m.refTagPrompt && !isI2v && !isT2v && refImages.length) outPrompt = applyRefTags(outPrompt, refImages.map((f) => titleOf(f) ?? ''), m.refTagPrompt)
    if (m.refVideoTagPrompt && !isI2v && !isT2v && videoRefs.length) outPrompt = applyVideoRefTags(outPrompt, m.refVideoTagPrompt) // list 13: @video1 → <VIDEO_REF_0>
    // two lanes (docs/archive/CONCURRENT-RENDERS-SPEC-2026-08-11.md): queue = serial in order, now =
    // starts immediately alongside anything running. The Queue panel owns progress/cancel either way.
    // Slot adoption is captured by stable item id NOW; the runner applies it when the take lands.
    const dispatch = lane === 'now' ? useStore.getState().renderNow : useStore.getState().enqueueRender
    dispatch({
      kind: 'gen',
      label: (clipName.trim() || selClip?.name || 'clip') + (isDraft ? ' · draft' : ''),
      thumb: isI2v ? startFile || undefined : refImages[0],
      engineLabel: m.label,
      estCost: estCost > 0 ? estCost : undefined,
      adoptSlotItemId: editingSlot && editTimelineIndex != null ? tlItems[editTimelineIndex]?.id : undefined,
      payload: {
        engine,
        mode: isT2v ? 'ref2v' : mode, // t2v rides the zero-ref ref2v wire (fal routes it to the t2v slug)
        prompt: outPrompt,
        freeform,
        scene,
        characters,
        beats,
        production,
        images: isI2v ? [startFile] : isT2v ? [] : refImages,
        imageAssetIds: (isI2v ? [startFile] : isT2v ? [] : refImages).map(f => idOfFile(f) ?? null),
        endImage: isI2v ? endFile || undefined : undefined,
        endImageAssetId: isI2v ? idOfFile(endFile) : undefined,
        // sent ONLY when the engine takes them — parked slots stay visible in the UI, never on the wire
        videoRefs: !isI2v && !isT2v && m.maxRefVideos > 0 && videoRefs.length ? videoRefs : undefined,
        audioRefs: !isI2v && !isT2v && m.maxRefAudios > 0 && audioRefs.length ? audioRefs : undefined,
        duration,
        resolution,
        draft: isDraft || undefined, // list 17: main renders it at 480p and the take keeps the id that finishes it
        aspectRatio: aspect,
        generateAudio: audio,
        ltxSize, // the size pick (bible 12.9) — main pins the local variant to it (H3: its base tier)
        h3Encoder,
        h3Upscale,
        h3UpscaleBy,
        h3Kernels,
        h3Set,
        seed: isLocal && Number(seed) > 0 ? Number(seed) : undefined, // 0 = random; local-engine wire (his dial 2026-09-01)
        negative: negative.trim() || undefined, // real on bf16 (CFG 4) only
        loras: isLocal && loraOn && liveLoras.length ? liveLoras : undefined, // the picks of this engine's family — local-engine wire (spec §7); the switch off = none sent
        loraOn,
        promptLink: promptLink ?? undefined,
        fieldLinks: Object.keys(fieldLinks).length ? fieldLinks : undefined,
        fieldOverrides: Object.keys(fieldOverrides).length ? fieldOverrides : undefined,
        characterLinks: charLinks.length ? charLinks : undefined,
        clipId: selectedClipId ?? undefined,
        name: clipName || undefined
      }
    })
    return say(lane === 'now' ? 'rendering now — watch the Queue panel' : 'queued → watch the Queue panel')
  }
  // list 17: finish a Draft take at 1080p. The supplier re-uses the Draft's prompt, refs, seed, shape
  // and length, so the row names the take and main rebuilds the rest from its frozen recipe. The
  // final lands as a new take beside the Draft.
  const draftFinish = (t: Take): { cost: number; why?: string } => {
    const m = modelFor(t.snapshot?.engine ?? t.engine)
    const secs = t.durationSec ?? (parseFloat(t.snapshot?.duration ?? '') || 0)
    const left = draftLeftMs(t)
    return { cost: (m.draft?.finalPerSec ?? 0) * secs, why: left <= 0 ? `a draft can be finished for ${DRAFT_DAYS} days, and this one is older — render it again` : undefined }
  }
  const finishDraft = (t: Take, n: number): void => {
    const snap = t.snapshot
    if (!selClip || !snap || !t.draft) return
    const m = modelFor(snap.engine)
    const cost = draftFinish(t).cost
    useStore.getState().enqueueRender({
      kind: 'gen',
      label: `${selClip.name} · T${n} at ${m.draft?.final ?? '1080p'}`,
      engineLabel: m.label,
      estCost: cost > 0 ? cost : undefined,
      payload: {
        engine: snap.engine,
        mode: snap.mode === 'i2v' ? 'i2v' : 'ref2v',
        prompt: '',
        freeform: snap.freeform,
        scene: snap.scene,
        characters: snap.characters,
        beats: snap.beats,
        production: snap.production,
        images: [],
        duration: snap.duration,
        resolution: m.draft?.final ?? '1080p',
        aspectRatio: snap.aspectRatio,
        generateAudio: snap.generateAudio,
        clipId: selClip.id,
        name: selClip.name,
        finishDraft: { clipId: selClip.id, takeId: t.id }
      }
    })
    setStatus(`queued → T${n} finishes at ${m.draft?.final ?? '1080p'} as a new take`)
  }
  // list 27: the Co-Director presses THIS panel's queue button (his switch on, on his go — main
  // checked both). The clip is selected like a click on it, and the press waits for the render in
  // which the form holds that clip, so it sends exactly what he would have sent.
  const firePending = useRef<{ clipId: string; done: (r: FireResult) => void; late: AbortSignal } | null>(null)
  const [, setFireTick] = useState(0)
  useEffect(
    () =>
      registerFire('clip', (clipId, _prompts, late) => new Promise((done) => {
        firePending.current = { clipId, done, late }
        setFireTick((n) => n + 1)
      })),
    []
  )
  useEffect(() => {
    const f = firePending.current
    if (f?.late.aborted) firePending.current = null // timed out: the Co-Director was told NOT fired
    if (!f || f.late.aborted || selectedClipId !== f.clipId || loadedClipId !== f.clipId) return
    firePending.current = null
    const ok = !check.errors.length
    const line = submitRender('queue')
    f.done({ ok, line: ok ? `${line} · ${model.label}${estStr ? ' · ' + estStr : ''}` : line })
  })

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
  const takeSelection = useTakeMultiSelect(selClip?.id, takes.filter((t) => !keepersOnly || (selClip && isKeeper(selClip, t.id))).map((t) => t.id))
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
        setRefImages(Array.from(new Set((snap.imageIds ?? []).map(fileOfId).filter((f): f is string => !!f))))
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

  // right-click → load the WHOLE recipe from a take's frozen snapshot into the form (user order
  // 2026-09-01; the ScoreCard's "restore recipe" is the sibling). The take itself never changes.
  const restoreRecipe = (take: Take): void => {
    const snap = take.snapshot
    const tn = (selClip?.takes.findIndex((t) => t.id === take.id) ?? -1) + 1
    if (!snap) {
      setStatus(`take ${tn} predates snapshots — nothing to restore`)
      return
    }
    // the WHOLE recipe of that take: its links and its seed too, so the re-render sends what it sent
    // (audit 2026-10-09 M36, M37). A copy: form edits never reach the take's frozen record.
    beatsDirtyRef.current = true
    fillForm(structuredClone({ ...snap, seed: snap.seed ?? take.seed }))
    setStatus(`↩ whole recipe loaded from take ${tn}`)
  }

  // ---- the cards (user order 2026-09-01: bordered cards, each its own space — takes / model /
  // prompt / beats). One recipe: the shared Section (legend + bordered body), collapse on the title.
  const toggleSec = (id: string): void =>
    setClosedSecs((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  // render-helper (NOT a component) so card children keep identity across toggles
  const sec = (id: string, title: React.ReactNode, body: React.ReactNode, right?: React.ReactNode): React.JSX.Element => (
    <Section title={title} right={right} collapsible open={!closedSecs.has(id)} onToggle={() => toggleSec(id)}>
      {body}
    </Section>
  )

  // ---- the REF STRIP (user design 2026-09-01): every reference floats ABOVE the prompt as a
  // chip — @name + type, slight tilt + slow float (the queue-bubble feel), grouped by type
  // (image / video / audio), double-click opens that ref's editor. This REPLACES the old
  // references/video-refs/audio-refs sections; each group keeps its own drop zone + ＋ add +
  // parked/warn rules, so nothing the sections did is lost. i2v swaps the strip for the
  // start/end frame slots (those are frames, not @refs).
  const chipTilt = (i: number): number => (((i * 37) % 5) - 2) * 0.6 // deterministic, ±1.2°
  const SQ = 64 // image faces are SQUARES, the house drag-box grammar in miniature (his calls 2026-09-01: square, then bigger)
  const chip = (i: number, warn: boolean, title: string, onDbl: (() => void) | undefined, body: React.ReactNode): React.JSX.Element => (
    <span key={'c' + i} style={{ display: 'inline-block', animation: `vd-ref-float ${5 + (i % 3)}s ease-in-out infinite` }}>
      <span
        onDoubleClick={onDbl}
        title={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 7px',
          borderRadius: 5,
          border: '1px solid ' + (warn ? 'var(--amber)' : 'var(--line2)'),
          background: 'var(--raised2)',
          fontSize: 10.5,
          cursor: onDbl ? 'pointer' : 'default',
          transform: `rotate(${chipTilt(i)}deg)`,
          userSelect: 'none'
        }}
      >
        {body}
      </span>
    </span>
  )
  const groupLb = (text: string, title: string): React.JSX.Element => (
    <span title={title} style={{ fontSize: 9, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', flex: '0 0 auto' }}>{text}</span>
  )
  // the VISIBLE drag-to-add box (his catch 2026-09-01: the drop target must be seen, not hover-only)
  const addBox = (title: string, onClick?: () => void, disabled?: boolean): React.JSX.Element => (
    <span
      className="vd-slot"
      title={title}
      onClick={disabled ? undefined : onClick}
      style={{ width: SQ, height: SQ, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0, minHeight: 0, ...(disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}) }}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>＋</span>
      <span style={{ fontSize: 8 }}>drag</span>
    </span>
  )
  const mentionedLower = new Set([...mentionedRefs].map((s) => s.toLowerCase()))
  const updVref = (i: number, patch: Partial<VideoRef>): void => setVideoRefs((a) => a.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const updAref = (i: number, patch: Partial<AudioRef>): void => setAudioRefs((a) => a.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  // ---- list 44 (VOICE-EXTRAS-SPEC-2026-10-01): a slot's role pill (a voice: timbre ↔ dialogue; a
  // Library track: ref → timbre → dialogue), the dialogue lock on the clip's length, and render
  // dialogue (the beats' lines spoken by the slot's voice, landing in the Library as its dialogue) ----
  const cycleRole = (i: number): void => {
    const r = audioRefs[i]
    const cur = roleOf(r)
    const next: AudioRole | undefined = r.voiceId ? (cur === 'dialogue' ? 'timbre' : 'dialogue') : cur === undefined ? 'timbre' : cur === 'timbre' ? 'dialogue' : undefined
    const refs = audioRefs.map((x, j) => {
      if (j !== i) return x
      const { role: _old, ...rest } = x
      void _old
      return next ? { ...rest, role: next } : rest
    })
    setAudioRefs(refs)
    if (next !== 'dialogue') return
    // dialogue locks the length: the engine's next length that holds the longest dialogue slot
    const dl = dialogueSlots(project, refs)[0]
    const lock = dl ? dialogueLock(engine, dl.sec) : undefined
    if (lock) setDuration(lock)
    else if (dl) toast(`@audio${dl.i + 1} runs ${dl.sec.toFixed(1)}s, longer than ${model.label}'s longest clip`, { kind: 'error' })
  }
  const sentAud = !isI2v && !isT2v && model.maxRefAudios > 0 ? audioRefs : []
  const dlgTop = dialogueSlots(project, sentAud)[0]
  const dLock = dlgTop ? dialogueLock(engine, dlgTop.sec) : undefined
  const voiceSlotCount = audioRefs.filter((r) => r.voiceId).length
  const VIA_LABEL: Record<string, string> = { fal: 'fal', elevenlabs: 'ElevenLabs', google: 'Google', local: 'Local' }
  const dialogueOf = (r: AudioRef): { text: string; why?: string; est?: number } => {
    const who = slotSpeaker(project, r, charLinks)
    const text = dialogueText(effectiveStructured, who, voiceSlotCount === 1)
    const vc = voiceClips.find((v) => v.id === r.voiceId)
    const rate = vc ? VOICE_CHAR_RATE[audioModelFor(vc.recipe.engine).id] : undefined
    const why = !selectedClipId
      ? 'add the clip to the Bin first: the dialogue lands on its slot'
      : !text
        ? `no dialogue line for ${who ?? 'this voice'} in the beats (a beat's dialogue, in a beat that names ${who ?? 'the character'})`
        : undefined
    return { text, why, est: rate != null && text ? (text.length / 1000) * rate : undefined }
  }
  const renderDialogue = (r: AudioRef, i: number): void => {
    const vc = voiceClips.find((v) => v.id === r.voiceId)
    const d = dialogueOf(r)
    if (!vc || d.why || !selectedClipId) return
    const vm = audioModelFor(vc.recipe.engine)
    useStore.getState().enqueueRender({
      kind: 'voice',
      label: `${vc.name} · dialogue`,
      engineLabel: `${vm.label} · via ${VIA_LABEL[vm.provider] ?? vm.provider}`,
      ...(d.est != null ? { estCost: d.est } : {}),
      payload: { voiceClipId: vc.id, engine: vc.recipe.engine, text: d.text, dialogueFor: { clipId: selectedClipId, voiceId: vc.id, ...(r.fromSheetId ? { fromSheetId: r.fromSheetId } : {}) } }
    })
    toast(`${vc.name}'s dialogue is queued: it lands in the Library and becomes @audio${i + 1}`, { kind: 'ok' })
  }
  const vParked = model.maxRefVideos === 0 // engine can't send them — keep visible, say why (law 4)
  const aParked = model.maxRefAudios === 0
  const trimPopover = (kind: 'v' | 'a', i: number, inSec: number | undefined, outSec: number | undefined, natSec: number | undefined, apply: (a: number, b: number) => void, clear: () => void): React.JSX.Element => (
    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, padding: 6, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, display: 'flex', gap: 4, alignItems: 'center', fontSize: 10 }}>
      <input ref={trimInRef} type="number" min={0} step={0.1} defaultValue={inSec ?? 0} style={{ ...ctl, width: 52 }} title="window start (seconds into the source)" />
      <span style={{ color: 'var(--dim)' }}>→</span>
      <input ref={trimOutRef} type="number" min={0} step={0.1} defaultValue={outSec ?? (natSec != null ? Math.min(natSec, (inSec ?? 0) + 15) : 5)} style={{ ...ctl, width: 52 }} title="window end (seconds into the source)" />
      <span
        className="btn vd-hbtn"
        onClick={() => {
          const a = parseFloat(trimInRef.current?.value ?? '')
          let b = parseFloat(trimOutRef.current?.value ?? '')
          if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) {
            if (b - a > 15) b = a + 15 // fal's ref cap — the window can't exceed the model max
            apply(Math.max(0, a), b)
          }
          setTrimSlot(null)
        }}
      >
        set
      </span>
      <span className="btn vd-hbtn" title="send the whole source" onClick={() => { clear(); setTrimSlot(null) }}>full</span>
    </div>
  )
  // an i2v frame slot — SAME grammar as the ref chips (his call 2026-09-01: no second look):
  // filled = square chip (tilt + float, name under, ✕ corner, dbl-click = Image Editor);
  // empty = the square dashed "＋ drag" box
  const frameSlot = (which: 'start' | 'end'): React.JSX.Element => {
    const file = which === 'start' ? startFile : endFile
    const clear = (): void => (which === 'start' ? setStartFile('') : setEndFile(''))
    const t = file ? titleOf(file) : undefined
    if (!file) return addBox(`set the ${which} frame — click picks from the Library, or drag an image onto this box`, () => setPicker(which))
    return chip(
      which === 'start' ? 0 : 1,
      false,
      `${t ?? '(untitled)'} — the ${which} frame\ndouble-click = open in the Image Editor`,
      () => {
        const id = idOfFile(file)
        if (!id) return
        useStore.getState().setEditorImage(id)
        openImageEditor()
      },
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <span style={{ position: 'relative' }}>
          <img src={mediaUrl(file)} alt="" style={{ width: SQ, height: SQ, objectFit: 'cover', borderRadius: 3, display: 'block' }} />
          <span
            title={`clear the ${which} frame`}
            style={{ position: 'absolute', top: -5, right: -5, width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, fontSize: 8, color: 'var(--dim)', cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              clear()
            }}
          >
            ✕
          </span>
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--gold)', maxWidth: SQ + 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t ?? '(untitled)'}</span>
      </span>
    )
  }
  const refStrip = isI2v ? (
    // ONE ROW, labels LEFT — the img-group grammar exactly, so mode switches never shove the
    // card around (his call 2026-09-01)
    <div className="field" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 10, padding: '2px 0 6px' }}>
      <style>{`@keyframes vd-ref-float { 0% { transform: translateY(0) } 50% { transform: translateY(-3px) } 100% { transform: translateY(0) } }`}</style>
      <span
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
        style={{ ...takeHL('start'), display: 'inline-flex', alignItems: 'center', gap: 6, padding: 3, borderRadius: 6, outline: dragTarget === 'start' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
      >
        {groupLb('start', 'the frame the render starts on — drag a Library image here')}
        {frameSlot('start')}
      </span>
      <span
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
        style={{ ...(model.endFrame ? takeHL('end') : { opacity: 0.35, pointerEvents: 'none' }), display: 'inline-flex', alignItems: 'center', gap: 6, padding: 3, borderRadius: 6, outline: dragTarget === 'end' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
        title={model.endFrame ? 'optional — the render ends on this frame' : `${model.label} has no end frame — kept for other models, not sent`}
      >
        {groupLb('end', 'optional — the render ends on this frame')}
        {frameSlot('end')}
      </span>
    </div>
  ) : (
    <div className="field" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 10, padding: '2px 0 6px' }}>
      <style>{`@keyframes vd-ref-float { 0% { transform: translateY(0) } 50% { transform: translateY(-3px) } 100% { transform: translateY(0) } }`}</style>
      {/* ---- images ---- */}
      <span
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
        style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 3, borderRadius: 6, outline: dragTarget === 'ref' || takeDrop === 'refs' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
      >
        {groupLb('img', isT2v ? 'image refs — t2v renders from words alone: refs are kept but will NOT be sent' : `image refs (@refs, ≤${model.maxRefImages}) — drag Library images here, or type @ in the prompt; a T-chip drop restores that take's refs`)}
        {refImages.map((f, i) => {
          const t = titleOf(f)
          const warn = !t || !mentionedRefs.has(t)
          return chip(
            i,
            warn,
            `${t ?? '(untitled)'} — image ref` +
              (warn ? '\n⚠ not @mentioned in the prompt — the model gets it unanchored' : '') +
              '\ndouble-click = open in the Image Editor · ✕ removes it (and strips its @name from the prompt)',
            () => {
              const id = idOfFile(f)
              if (!id) return
              useStore.getState().setEditorImage(id)
              openImageEditor()
            },
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ position: 'relative' }}>
                {/* SQUARE face, bigger — the house drag-box grammar in miniature (his catch) */}
                <img src={mediaUrl(f)} alt="" style={{ width: SQ, height: SQ, objectFit: 'cover', borderRadius: 3, display: 'block' }} />
                <span
                  title="remove — also strips its @name from the prompt"
                  style={{ position: 'absolute', top: -5, right: -5, width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, fontSize: 8, color: 'var(--dim)', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRefImages((prev) => prev.filter((x) => x !== f))
                    if (t)
                      setFreeform((p) =>
                        p
                          .replace(new RegExp('\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), '')
                          .replace(/\s{2,}/g, ' ')
                          .trim()
                      )
                  }}
                >
                  ✕
                </span>
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--gold)', maxWidth: SQ + 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t ?? '(untitled)'}</span>
            </span>
          )
        })}
        {model.maxRefImages === 0
          ? // parked, with the reason (law 4: off-engine controls grey WITH why, never vanish)
            addBox(`${model.label} has no reference support yet — it lands in a later phase`, undefined, true)
          : addBox('add an image reference — click picks from the Library, or drag a Library image onto this box', () => setPicker('ref'))}
      </span>
      {/* ---- videos ---- */}
      {(model.maxRefVideos > 0 || videoRefs.length > 0) && (
        <span
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
          style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 3, borderRadius: 6, opacity: vParked ? 0.55 : 1, outline: takeDrop === 'vref' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
        >
          {groupLb('vid', vParked ? `video refs — no ${model.label} support, kept but NOT sent` : `video refs (@video1…, ≤${model.maxRefVideos} · ${model.refVideoEachMaxSec ? `${model.refVideoEachMaxSec}s each` : '2–15s combined'}) — write e.g. "Continue from @video1." in the prompt; drag a Library video or a T-chip here`)}
          {videoRefs.map((r, i) => {
            const info = vrefInfo(r)
            const secs = vrefSec(r)
            const tag = `@video${i + 1}`
            const windowed = r.inSec != null && r.outSec != null
            const trimOpen = trimSlot?.kind === 'v' && trimSlot.i === i
            return (
              <span key={'v' + i} style={{ position: 'relative' }}>
                {chip(
                  i + 3,
                  !vParked && !mentionedLower.has(tag),
                  `${tag} = ${info.name}${secs != null ? ` · sends ${secs.toFixed(1)}s` : ''}` +
                    (!vParked && !mentionedLower.has(tag) ? `\n⚠ mention ${tag} in the prompt to bind it` : '') +
                    '\ndouble-click = open in the Video Editor · ✂ sends only a window',
                  () => {
                    if (r.takeRef) useStore.getState().setEditorVideo({ takeRef: r.takeRef })
                    else if (r.videoId) useStore.getState().setEditorVideo({ videoId: r.videoId })
                    else return
                    openVideoEditor()
                  },
                  <>
                    <span style={{ color: info.file ? 'var(--amber)' : 'var(--bad)' }}>▶</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>{tag}</span>
                    <span style={{ maxWidth: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: info.file ? 'var(--body)' : 'var(--bad)' }}>{info.name}</span>
                    <span
                      className="btn vd-hbtn"
                      style={{ fontSize: 9 }}
                      title={windowed ? `sends ${r.inSec!.toFixed(1)}–${r.outSec!.toFixed(1)}s of the source — click to change` : 'send only a window of this video (fal caps refs at 15s combined)'}
                      onClick={() => setTrimSlot(trimOpen ? null : { kind: 'v', i })}
                    >
                      ✂ {windowed ? `${(r.outSec! - r.inSec!).toFixed(1)}s` : secs != null ? `${secs.toFixed(1)}s` : '…'}
                    </span>
                    <span style={{ cursor: 'pointer', color: 'var(--dim)', padding: '0 2px' }} onClick={() => { setVideoRefs((a) => a.filter((_, j) => j !== i)); setTrimSlot(null) }}>✕</span>
                  </>
                )}
                {trimOpen && trimPopover('v', i, r.inSec, r.outSec, info.natSec, (a, b) => updVref(i, { inSec: a, outSec: b }), () => updVref(i, { inSec: undefined, outSec: undefined }))}
              </span>
            )
          })}
          {!vParked && videoRefs.length < model.maxRefVideos && (
            <span style={{ position: 'relative' }}>
              {addBox(
                libVideos.length === 0 && !project?.clips.some((c) => c.takes.length > 0) ? 'no Library videos or takes yet — click opens the Library' : 'add a video reference — click picks a Library video or a take, or drag either onto this box',
                () => (libVideos.length === 0 && !project?.clips.some((c) => c.takes.length > 0) ? openLibraryPanel() : setVidPicker((v) => !v))
              )}
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
        </span>
      )}
      {/* ---- audio ---- */}
      {(model.maxRefAudios > 0 || audioRefs.length > 0) && (
        <span
          onDragOver={(e) => {
            const t = Array.from(e.dataTransfer.types)
            if (t.includes(MIME_AUDIO) || t.includes(MIME_VOICE)) {
              e.preventDefault()
              setTakeDrop('aref')
            }
          }}
          onDragLeave={() => setTakeDrop(null)}
          onDrop={(e) => {
            setTakeDrop(null)
            const voiceId = e.dataTransfer.getData(MIME_VOICE) // list 44: a 🎤 voice from the Bin
            const id = e.dataTransfer.getData(MIME_AUDIO)
            if (!id && !voiceId) return
            e.preventDefault()
            setAudioRefs((a) => [...a, voiceId ? { voiceId } : { audioId: id }])
          }}
          style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 3, borderRadius: 6, opacity: aParked ? 0.55 : 1, outline: takeDrop === 'aref' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
        >
          {groupLb('aud', aParked ? `audio refs — no ${model.label} support, kept but NOT sent` : `audio refs (@audio1…, ≤${model.maxRefAudios} · ≤15s combined) — e.g. "Cut the motion to @audio1." · needs ≥1 image/video ref · drag a Library track here`)}
          {audioRefs.map((r, i) => {
            const a = r.audioId ? libAudio.find((x) => x.id === r.audioId) : undefined
            const vc = r.voiceId ? voiceClips.find((v) => v.id === r.voiceId) : undefined
            const sh = r.fromSheetId ? project?.charSheets?.find((x) => x.id === r.fromSheetId) : undefined
            const name = vc?.name ?? a?.title ?? (r.voiceId ? '(deleted voice)' : '(deleted track)')
            const live = vc ? vc.takes.some((t) => !t.disabled) : !!a // a voice sends its playing take: none yet = nothing to send
            const secs = arefSec(r)
            const tag = `@audio${i + 1}`
            const windowed = r.inSec != null && r.outSec != null
            const trimOpen = trimSlot?.kind === 'a' && trimSlot.i === i
            const tooLong = !windowed && secs != null && secs > 15
            const role = roleOf(r)
            const dlg = vc ? dialogueOf(r) : undefined
            return (
              <span key={'a' + i} data-aslot={i} style={{ position: 'relative' }}>
                {chip(
                  i + 7,
                  !aParked && !mentionedLower.has(tag),
                  `${tag} = ${vc ? `the voice ${name}` : name}${sh ? `, brought by the sheet ${sh.name} (unlinking it takes this slot away)` : ''}${secs != null ? ` · sends ${secs.toFixed(1)}s` : ''}` +
                    (vc && !live ? '\n⚠ this voice has no take yet: render one in the Voice card' : '') +
                    (!aParked && !mentionedLower.has(tag) ? `\n⚠ mention ${tag} in the prompt to bind it` : '') +
                    (tooLong ? `\n⚠ whole track is ${secs!.toFixed(0)}s — cut a ≤15s window or the render will be blocked` : '') +
                    (vc ? '\ndouble-click = open the voice in the Voice card · ✂ sends only a window' : '\ndouble-click = show in the Library (music has no editor card) · ✂ sends only a window'),
                  () => {
                    if (!vc) return openLibraryPanel()
                    useStore.getState().setEditorVoice(vc.id)
                    openVoicesCard()
                  },
                  <>
                    <span style={{ color: live ? 'var(--amber)' : 'var(--bad)' }}>{r.voiceId ? '🎤' : '♪'}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>{tag}</span>
                    <span style={{ maxWidth: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: live ? 'var(--body)' : 'var(--bad)' }}>{name}</span>
                    {sh && <span style={{ color: 'var(--gold)', fontSize: 9.5, maxWidth: 80, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>⛉ {sh.name}</span>}
                    <span
                      className="btn vd-hbtn"
                      data-role={role ?? 'ref'}
                      style={{ fontSize: 9 }}
                      title={
                        role === 'dialogue'
                          ? `dialogue: this exact audio, lips in sync; the clip's length locks to it · click = ${r.voiceId ? 'timbre' : 'a plain ref'}`
                          : role === 'timbre'
                            ? "timbre: the voice's sound only (its accent and pace); the words come from the dialogue lines, so the delivery can drift from this voice · click = dialogue"
                            : 'a plain reference (music, sound): the prompt says nothing about it · click = timbre (a voice to speak in)'
                      }
                      onClick={() => cycleRole(i)}
                    >
                      {role ?? 'ref'}
                    </span>
                    {vc && dlg && (
                      <span
                        className="btn vd-hbtn"
                        data-render-dialogue
                        style={{ fontSize: 9, ...(dlg.why ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}
                        title={dlg.why ?? `speak the clip's lines in ${vc.name}: “${dlg.text.slice(0, 240)}${dlg.text.length > 240 ? '…' : ''}” · the audio lands in the Library and this slot plays it as dialogue`}
                        onClick={() => renderDialogue(r, i)}
                      >
                        🎤 dialogue{dlg.est != null ? ` · $${dlg.est.toFixed(3)}` : ''}
                      </span>
                    )}
                    <span
                      className="btn vd-hbtn"
                      style={{ fontSize: 9, ...(!windowed && tooLong ? { color: 'var(--bad)' } : {}) }}
                      title={windowed ? `sends ${r.inSec!.toFixed(1)}–${r.outSec!.toFixed(1)}s — click to change` : tooLong ? `whole track is ${secs!.toFixed(0)}s — cut a ≤15s window or the render will be blocked` : 'send only a window of this track'}
                      onClick={() => setTrimSlot(trimOpen ? null : { kind: 'a', i })}
                    >
                      ✂ {windowed ? `${(r.outSec! - r.inSec!).toFixed(1)}s` : secs != null ? `${secs.toFixed(1)}s` : '…'}
                    </span>
                    <span style={{ cursor: 'pointer', color: 'var(--dim)', padding: '0 2px' }} onClick={() => { setAudioRefs((x) => x.filter((_, j) => j !== i)); setTrimSlot(null) }}>✕</span>
                  </>
                )}
                {trimOpen && trimPopover('a', i, r.inSec, r.outSec, secs ?? undefined, (x, y) => updAref(i, { inSec: x, outSec: y }), () => updAref(i, { inSec: undefined, outSec: undefined }))}
              </span>
            )
          })}
          {!aParked && audioRefs.length < model.maxRefAudios && (
            <span style={{ position: 'relative' }}>
              {addBox(
                libAudio.length || voiceClips.length ? 'add an audio reference — click picks a Library track or a Bin voice, or drag either onto this box' : 'no Library music or Bin voices yet — click opens the Library',
                () => (libAudio.length || voiceClips.length ? setAudPicker((v) => !v) : openLibraryPanel())
              )}
              {audPicker && (libAudio.length > 0 || voiceClips.length > 0) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 200, maxHeight: 200, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                  {libAudio.map((a) => (
                    <div key={a.id} onMouseDown={(e) => { e.preventDefault(); setAudioRefs((x) => [...x, { audioId: a.id }]); setAudPicker(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                      <Ic i={ScoreIcon} size={10} /> {a.title}{a.durationSec ? ` · ${a.durationSec.toFixed(0)}s` : ''}
                    </div>
                  ))}
                  {/* list 44: the Bin's voices — a voice slot sends the voice's playing take */}
                  {disabledLast(voiceClips).map((v) => {
                    const t = v.takes.find((x) => x.id === v.keeperTakeId) ?? v.takes[v.takes.length - 1]
                    return (
                      <div key={'v' + v.id} data-pick-voice={v.id} onMouseDown={(e) => { e.preventDefault(); setAudioRefs((x) => [...x, { voiceId: v.id }]); setAudPicker(false) }} title={v.takes.length ? 'a Bin voice: its playing take is what sends' : 'this voice has no take yet: render one in the Voice card first'} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260, opacity: v.takes.length && !v.disabled ? 1 : 0.5 }}>
                        🎤 {v.name}{t?.durationSec ? ` · ${t.durationSec.toFixed(1)}s` : ''}
                      </div>
                    )
                  })}
                </div>
              )}
            </span>
          )}
        </span>
      )}
    </div>
  )

  // nothing selected and nothing typed: the house empty state (uncommitted typed content keeps
  // the form — the EmptyState must never eat work the '+ new' adopt flow protects). When clips
  // exist they FLOAT here to be chosen from (user design 2026-09-01); none yet = the teaching line.
  if (!selectedClipId && !hasContent) {
    const clips = project?.clips ?? []
    return (
      <EmptyState>
        {clips.length > 0 ? (
          <>
            no clip open — double-click one
            <FloatPick
              items={clips.map((c) => {
                const keeper = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
                return { id: c.id, label: c.name, videoFile: keeper?.file, glyph: '▦' }
              })}
              onOpen={(id) => selectClip(id)}
              hint="double-click to open it here"
            />
          </>
        ) : (
          <>no clip open — double-click a clip in the Bin, or start one fresh</>
        )}
        <br />
        <span className="btn vd-hbtn" style={{ marginTop: 8, display: 'inline-block' }} onClick={newClip}>
          ＋ new clip
        </span>
      </EmptyState>
    )
  }

  // the LoRA side panel (MINIMAX-H3-LOCAL-SPEC §4.2): Image Gen's right column, for the local
  // engines only — local (shelf + folders) · civit · official, filtered to the picked family
  const loraFamily = engine === 'h3local' ? LORA_FAMILIES.h3 : LORA_FAMILIES.ltx
  const usePick = (rel: string): void => setLoras((l) => (l.some((x) => x.name === rel) ? l : [...l, { name: rel, weight: 1 }]))
  const unusePick = (rel: string): void => setLoras((l) => l.filter((x) => x.name !== rel))
  const loraSide = !isLocal ? null : sideOpen ? (
    <div style={{ width: sideW, flex: '0 0 auto', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <div
        onMouseDown={(e) => {
          e.preventDefault()
          const x0 = e.clientX
          const w0 = sideW
          const move = (ev: MouseEvent): void => setSideW(Math.max(200, Math.min(520, w0 - (ev.clientX - x0))))
          const up = (): void => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
        title="drag to resize"
        style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 3 }}
      />
      <div style={{ padding: '8px 8px 0', display: 'flex', alignItems: 'center' }}>
        <span className="lb" style={{ margin: 0 }}>{loraFamily.label}</span>
        <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setSideOpen(false)} title="fold the side panel away">
          ›
        </span>
      </div>
      <LoraSidebar family={loraFamily} picks={loras} onUse={usePick} onUnuse={unusePick} />
    </div>
  ) : (
    <div onClick={() => setSideOpen(true)} title="show the lora side panel" style={{ width: 22, flex: '0 0 auto', borderLeft: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--dim)', fontSize: 10, fontFamily: 'var(--mono)', writingMode: 'vertical-rl' }}>
      ‹ loras
    </div>
  )

  return (
    <div className="vd-panel" style={{ display: 'flex', height: '100%' }}>
    <div className="vd-inspector" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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

      {(videoUrl || takes.length > 0) && sec('takes', 'takes', (<>
      {videoUrl && (
        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
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
              title={pvTake ? 'click = play / pause · drag = onto the timeline (in/out window rides along), the Library, or a @video ref slot · right-click = frame grab' : 'click = play / pause'}
              onClick={togglePvPlay}
              onContextMenu={(e) => {
                // the timeline monitor's frame-grab, here (user order 2026-09-01)
                e.preventDefault()
                setPvCtx({ x: e.clientX, y: e.clientY })
              }}
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
                {isKeeper(selClip!, pvTake!.id) ? ' ★' : ''}
                {pvWindowed ? ' · window rides the drag' : ''}
              </span>
              <span>out {(pvOut ?? jogDur).toFixed(2)}s</span>
            </div>
          )}
        </div>
      )}

      {takes.length > 0 && (
        <div className="field" style={{ marginTop: 2 }}>
          <div className="lb" title={'click = select · ~ or right-click = keeper (a flag — many per set; the last flagged plays) · ~ = flag / unflag the selected · a lit ★ = click to unflag · ★ only = just the keepers · Ctrl/⌘-click = add/remove · Shift-click = range · drag a card onto any field to restore just that field from the take · right-click = keeper / color / disable / load recipe / delete'}>
            {editingSlot ? `takes — sets this slot (#${editTimelineIndex! + 1})` : 'takes'}{takeSelection.selectedIds.length > 1 ? ` · ${takeSelection.selectedIds.length} selected` : ''}
            <KeepersOnlySwitch on={keepersOnly} onChange={setKeepersOnly} />
          </div>
          {editingSlot && takes.length > 1 && (
            <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 6 }}>
              ▦ the take you pick applies to THIS slot only — all other edits affect the whole clip.
            </div>
          )}
          <div
            {...arrowNav((id, e) => {
              // §19: arrows preview only — the take plays in the Clip Monitor, the keeper stays
              const t = takes.find((x) => x.id === id)
              if (!t) return
              takeSelection.select({ ...e, ctrlKey: false, metaKey: false }, id)
              playTake(t.file)
            }, (id) => {
              // list 6: ~ flags / unflags the selected takes
              if (!selClip) return
              const ids = takeSelection.selectedIds.length ? takeSelection.selectedIds : id ? [id] : []
              toggleKeepers('clip', selClip.id, ids, null)
            })}
            className="vd-slots"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}
          >
            {/* S-B = the storyboard / live recipe (duration setting + current beats + keyframe) — always first */}
            <span
              className={'vd-slot' + (slotUsesRecipe || (!editingSlot && previewRecipe) ? ' filled' : '')}
              onClick={pickRecipeForSlot}
              title={
                editingSlot
                  ? 'S-B — show the STORYBOARD (live recipe) on this timeline slot (duration setting + current beats + keyframe)'
                  : 'S-B — preview the storyboard (live recipe) in the Clip Monitor (what the next render will use)'
              }
              style={{ width: 118, minHeight: 96, height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>S-B{slotUsesRecipe || (!editingSlot && previewRecipe) ? ' ★' : ''}</span>
              <span style={{ fontSize: 8, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.3 }}>story<br />board</span>
            </span>
            {takes.map((t, i) => {
              if (keepersOnly && selClip && !isKeeper(selClip, t.id)) return null // list 6: ★ only
              const isSel = t.id === slotTakeId
              const selected = takeSelection.isSelected(t.id)
              const dis = !!t.disabled
              return (
                <span
                  key={t.id}
                  data-nav={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(MIME_TAKE, JSON.stringify({ clipId: selClip?.id, takeId: t.id }))}
                  onClick={(e) => {
                    if (takeSelection.select(e, t.id)) return
                    if (editingSlot && editTimelineIndex != null) {
                      // by stable id, through setSlotView — a different-length take ripples what follows
                      const slotId = tlItems[editTimelineIndex]?.id
                      if (slotId) void useStore.getState().setSlotView(slotId, { takeId: t.id })
                    } else if (selClip) {
                      // list 2 (his rule 10-03): a click selects and shows the take, never flags it — only ~ or right-click make a keeper
                      useStore.getState().setPreviewRecipe(false) // back to a take view in the Clip Monitor
                    }
                    playTake(t.file)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    const takeIds = takeSelection.contextIds(t.id)
                    if (!takeSelection.isSelected(t.id)) takeSelection.selectOnly(t.id)
                    setTakeCtx({ x: e.clientX, y: e.clientY, takeId: t.id, takeIds, label: `T${i + 1}` })
                  }}
                  onDoubleClick={() => {
                    // double-click = open THIS take big in the Clip Monitor (its view-only override)
                    useStore.getState().requestMonitorTake(t.id)
                    openClipMonitor()
                  }}
                  title={
                    // the model line (bible 12.9/engine-confirmed law): full size label, the
                    // seed the engine picked, and the transformer FILE the executed graph named
                    `model: ${t.engine === 'ltx25' ? `LTX 2.5 (${(localModelFor(t.localVariant ?? '')?.label ?? 'auto — size not recorded').replace(/[()]/g, '')})` : t.engine === 'h3local' ? `MiniMax H3 (${(localModelFor(t.localVariant ?? '')?.label ?? 'auto — size not recorded').replace(/[()]/g, '')})` : modelFor(t.engine ?? 'seedance2').label}` +
                    (t.seed != null ? ` · seed ${t.seed}` : '') +
                    (t.ltxFile ? `\nfile: ${t.ltxFile} (engine-confirmed)` : '') +
                    // loras the take rendered with (frozen snapshot), name × weight — only when used
                    (t.snapshot?.loras?.length ? `\nlora: ${t.snapshot.loras.map((l) => `${l.name.replace(/\.safetensors$/, '')} ×${l.weight}`).join(' · ')}` : '') +
                    // list 52: an enhanced copy says what was done, and to which take
                    (t.enhanced ? `\n${enhanceWords(t.enhanced)} — an enhanced copy of ${takes.some((x) => x.id === t.enhanced!.of) ? `T${takes.findIndex((x) => x.id === t.enhanced!.of) + 1}` : 'a take'}` : '') +
                    // list 17: a Draft says how long it can still be finished
                    (t.draft ? `\ndraft (480p) · ${draftLeftMs(t) > 0 ? `${Math.max(1, Math.ceil(draftLeftMs(t) / 86_400_000))} day(s) left to finish it at 1080p (right-click)` : `its ${DRAFT_DAYS} days are over, it can no longer be finished`}` : '') +
                    '\n' +
                    (dis ? 'DISABLED (skipped by auto-keeper) · ' : '') +
                    (editingSlot ? 'set this take for this timeline slot' : 'click = select + show · ~ = flag / unflag as a keeper · drag to Bin = new clip from this take') +
                    ' · Ctrl/⌘-click = add/remove · Shift-click = range' +
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
                    outline: selected ? '2px solid var(--amber)' : undefined,
                    outlineOffset: 2,
                    // list 52: enhanced copies wear his outline — blue interpolated, green upscaled, purple both
                    boxShadow: t.enhanced ? `0 0 0 2px ${enhanceTone(t.enhanced)}` : undefined,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                  }}
                >
                  <Thumbnail videoFile={t.file} scrubVideo={t.file} w={108} h={61} />
                  {t.draft && (
                    <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,.72)', color: draftLeftMs(t) > 0 ? 'var(--amber)' : 'var(--dim)', fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, letterSpacing: '.06em' }}>
                      DRAFT
                    </span>
                  )}
                  {dis && (
                    <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.72)', color: 'var(--bad)', fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, letterSpacing: '.06em' }}>
                      OFF
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 11, color: 'var(--txt-hi)' }}>
                    <b>T{i + 1}</b>
                    {selClip && <KeeperStar lit={isKeeper(selClip, t.id)} onUnflag={() => toggleKeepers('clip', selClip.id, [t.id], false)} />}
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>
                      {t.durationSec ? `${Math.round(t.durationSec * 10) / 10}s` : ''}
                    </span>
                  </span>
                  <span style={{ fontSize: 8.5, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {/* local takes wear the size that ACTUALLY rendered (registry label, recorded truth) */}
                    {t.engine === 'ltx25' && t.localVariant ? `LTX 2.5 (${(localModelFor(t.localVariant)?.label ?? t.localVariant).replace(/[()]/g, '')})` : t.engine === 'h3local' && t.localVariant ? `MiniMax H3 (${(localModelFor(t.localVariant)?.label ?? t.localVariant).replace(/[()]/g, '')})` : modelFor(t.engine).label} · {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </span>
              )
            })}
            {takeCtx && selClip && (() => {
              const ctxTake = takes.find((x) => x.id === takeCtx.takeId)
              const ctxIds = takeCtx.takeIds.filter((id) => takes.some((t) => t.id === id))
              const ctxTakes = ctxIds.map((id) => takes.find((t) => t.id === id)).filter((t): t is Take => !!t)
              const batch = ctxIds.length > 1
              const label = batch ? `${ctxIds.length} selected takes` : takeCtx.label
              const updateSelected = (patch: { color?: string | null; disabled?: boolean }): void => {
                void (async () => {
                  for (const id of ctxIds) await useStore.getState().setTakeMeta(selClip.id, id, patch)
                })()
              }
              return (
                <ContextMenu
                  x={takeCtx.x}
                  y={takeCtx.y}
                  entries={[
                    ...keeperEntries('clip', selClip, ctxIds), // list 6: ★ keeper / ☆ not a keeper
                    { label: '', sep: true },
                    {
                      label: <>↩ load {takeCtx.label}&apos;s recipe</>,
                      title: "fills the whole form from this take's frozen snapshot — prompt, fields, beats, refs, dials",
                      onClick: () => {
                        const t = takes.find((x) => x.id === takeCtx.takeId)
                        if (t) restoreRecipe(t)
                      }
                    },
                    // list 17: a Draft finishes at 1080p as a new take, for the seven days its id lives
                    ...(ctxTake?.draft
                      ? [
                          {
                            label: `⬆ finish ${takeCtx.label} at ${modelFor(ctxTake.snapshot?.engine ?? ctxTake.engine).draft?.final ?? '1080p'}${draftFinish(ctxTake).cost > 0 ? ` · ~$${draftFinish(ctxTake).cost.toFixed(2)}` : ''}`,
                            disabled: !!draftFinish(ctxTake).why,
                            title: draftFinish(ctxTake).why ?? 'renders the same video at 1080p from this draft — it lands as a new take, the draft stays',
                            onClick: () => finishDraft(ctxTake, takes.findIndex((x) => x.id === ctxTake.id) + 1)
                          }
                        ]
                      : []),
                    { label: '', sep: true },
                    {
                      // swatch row: each square saves its color; the click bubbles to the row and closes the menu
                      label: (
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ color: 'var(--dim)' }}>color</span>
                          {TAKE_COLORS.map((c) => (
                            <span
                              key={c}
                              onClick={() => updateSelected({ color: c })}
                              style={{ width: 14, height: 14, borderRadius: 4, background: c, cursor: 'pointer', border: ctxTake?.color === c ? '2px solid var(--txt-hi)' : '1px solid var(--line2)' }}
                            />
                          ))}
                          <span
                            onClick={() => updateSelected({ color: null })}
                            title="clear color"
                            style={{ width: 14, height: 14, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--line2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--dim)' }}
                          >
                            ✕
                          </span>
                        </span>
                      )
                    },
                    {
                      label: ctxTakes.every((t) => t.disabled) ? `✓ enable ${label}` : `⃠ disable ${label} (dud)`,
                      danger: !ctxTakes.every((t) => t.disabled),
                      onClick: () => updateSelected({ disabled: !ctxTakes.every((t) => t.disabled) })
                    },
                    {
                      label: <><Ic i={Trash2} size={12} /> delete {label}…</>,
                      danger: true,
                      onClick: async (): Promise<void> => {
                        // ALWAYS warns (user order 2026-08-27) — unlike Bin deletes, no zero-uses skip
                        const p = useStore.getState().project
                        const pinned = (p?.timelines ?? []).reduce((n, tl) => n + tl.items.filter((it) => it.clipId === selClip.id && ctxIds.includes(it.takeId ?? '')).length, 0)
                        const msg =
                          batch
                            ? `Delete ${ctxIds.length} selected takes? ${pinned ? `${pinned} pinned timeline shot(s) on them are removed; ` : ''}dynamic shots fall back to the keeper unless this removes the last take. Video files stay on disk. (undoable — Ctrl+Z)`
                            : takes.length === 1
                            ? `Delete ${takeCtx.label} — the clip's only take? Every timeline shot of this clip gets removed. The video file stays on disk. (undoable — Ctrl+Z)`
                            : pinned > 0
                              ? `Delete ${takeCtx.label}? ${pinned} pinned timeline shot(s) on it get removed; dynamic shots move to the keeper. The video file stays on disk. (undoable — Ctrl+Z)`
                              : `Delete ${takeCtx.label}? Dynamic timeline shots move to the keeper. The video file stays on disk. (undoable — Ctrl+Z)`
                        if (await confirmDialog(msg, { confirmLabel: 'Delete', danger: true })) {
                          for (const id of ctxIds) await useStore.getState().deleteTake(selClip.id, id)
                        }
                      }
                    },
                    { label: '', sep: true },
                    {
                      label: <><Ic i={Wand2} size={12} /> ⑂ edit {takeCtx.label} v2v</>,
                      onClick: () => {
                        useStore.getState().setEditorVideo({ takeRef: { clipId: selClip.id, takeId: takeCtx.takeId } })
                        openVideoEditor()
                      }
                    },
                    {
                      label: `enhance ${takeCtx.label}…`,
                      title: 'opens ENHANCE on this take — interpolate (more frames, slow motion) and upscale (more pixels); the result is a copy',
                      onClick: () => useStore.getState().openEnhance({ kind: 'take', clipId: selClip.id, takeId: takeCtx.takeId })
                    },
                    // list 42: a depth map of the take (a Library video, never a take)
                    { label: depthLabel(ctxTake?.durationSec), title: DEPTH_TITLE, onClick: () => queueDepth({ kind: 'take', clipId: selClip.id, takeId: takeCtx.takeId }, `${selClip.name} ${takeCtx.label}`, ctxTake?.durationSec) },
                    { label: '', sep: true },
                    // that take through the shared save box (format list = the choice) — TODO-2026-09-22 §21
                    ...(ctxTake ? [exportEntry(ctxTake.file, 'video', `${selClip.name} ${takeCtx.label}`, `export ${takeCtx.label} as…`)] : [])
                  ]}
                  onClose={() => setTakeCtx(null)}
                />
              )
            })()}
            {takes.length > 0 && selClip && (
              <span
                className="vd-slot"
                title="edit the ★ take v2v — opens the Video Editor tree on it; keep a result by dragging it out"
                onClick={() => {
                  const tid = slotTakeId ?? selClip.keeperTakeId ?? takes[takes.length - 1].id
                  useStore.getState().setEditorVideo({ takeRef: { clipId: selClip.id, takeId: tid } })
                  openVideoEditor()
                }}
                style={{ width: 118, minHeight: 96, height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>⑂ edit</span>
                <span style={{ fontSize: 8, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.3 }}>video<br />editor</span>
              </span>
            )}
          </div>
        </div>
      )}
      </>))}

      {sec('setup', 'model', <>
      {/* row 1: model · via · mode — snug, natural widths (user order 2026-09-01: no stretching) */}
      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto', ...takeHL('engine') }} onDragOver={takeOver('engine')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('engine', e)}>
          <div className="lb">model</div>
          <Dropdown
            value={familyOf(engine) ?? encodeEngine(engine, ltxSize)}
            options={[...modelOptions(engine), ...(missingPinOption(engine, ltxSize) ? [missingPinOption(engine, ltxSize)!] : [])].map((o): DropdownOption => ({ value: o.value, label: o.label }))}
            onChange={(v) => {
              // MODEL picks the family; the engine lands on the remembered VIA for it. Local
              // sizes stay their own entries (bible 12.9) — 'ltx25|<sizeId>' decodes as before
              if (isFamily(v)) {
                setEngine(engineForFamily(v))
                setLtxSize(undefined)
                return
              }
              const dec = decodeEngine(v)
              setEngine(dec.engine)
              setLtxSize(dec.ltxSize)
              // picking an undownloaded local engine KEEPS the selection and fires the wizard
              // (the ScoreCard shape) — the Models card owns the download from there
              if (dec.engine === 'h3local' && !h3St.renderReady) void modelWizard('minimax-h3')
              else if (modelFor(dec.engine).provider === 'local' && !ltxSt.renderReady) void modelWizard('ltx-2.5')
            }}
            style={{ minWidth: 150 }}
            title={'the model — switching keeps ALL inputs; unsupported ones grey out. Local sizes list per installed download' + (model.notes ? `\n${model.notes}` : '')}
          />
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <div className="lb">via</div>
          <Dropdown
            value={engine}
            disabled={viaOptions(familyOf(engine) ?? '', engine).filter((o) => !o.disabled).length <= 1}
            options={viaOptions(familyOf(engine) ?? '', engine).map((o): DropdownOption => ({ value: o.value, label: o.label, disabled: o.disabled, title: o.title }))}
            onChange={(v) => {
              const id = v as EngineId
              setEngine(id)
              const fam = familyOf(id)
              if (fam) rememberVia(fam, id)
            }}
            style={{ minWidth: 110 }}
            title="who runs this model — each lane bills its own account; your pick is remembered per model"
          />
        </div>
        <div style={takeHL('mode')} onDragOver={takeOver('mode')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('mode', e)}>
          <div className="lb">mode</div>
          <div className="vd-modes">
            {(['ref2v', 'i2v', 't2v'] as const).map((m) => {
              // t2v (his mode 2026-09-01): words only — needs a t2v slug or an adapter with zero-ref grammar
              const supported = m === 't2v' ? !!model.endpoints.t2v || !!model.provider : model.modes.includes(m)
              return (
                <span
                  key={m}
                  className={'vd-mode' + (mode === m ? ' on' : '')}
                  style={supported ? undefined : { opacity: 0.35, cursor: 'not-allowed' }}
                  title={m === 't2v' ? (supported ? 'render from words alone — refs park, none required' : `${model.label} can't render from words alone`) : supported ? undefined : `${model.label} doesn't support ${m}`}
                  onClick={() => supported && switchMode(m)}
                >
                  {m}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* row 2: the dials — natural widths, one tight line, audio rides the row's end */}
      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={takeHL('duration')} onDragOver={takeOver('duration')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('duration', e)}>
          <div className="lb">
            duration
            {dLock && dlgTop && (
              <span data-dlock title={`locked to @audio${dlgTop.i + 1}'s dialogue (${dlgTop.sec.toFixed(1)}s → ${dLock}s). Another length is allowed; the ⚑ above the render button says so`} style={{ marginLeft: 4, color: duration === dLock ? 'var(--dim)' : 'var(--amber)' }}>
                🔒
              </span>
            )}
          </div>
          <Dropdown value={duration} options={withCurrent(model.durations, duration).map((d) => ({ value: d, label: d }))} onChange={setDuration} style={{ width: 78 }} title="clip length in seconds" />
        </div>
        <div style={takeHL('resolution')} onDragOver={takeOver('resolution')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('resolution', e)}>
          <div className="lb">resolution</div>
          <Dropdown value={renderRes} disabled={isDraft} options={withCurrent(model.resolutions, renderRes).map((r) => ({ value: r, label: r }))} onChange={setResolution} style={{ width: 90 }} title={isDraft ? `a draft is always 480p — finish it at ${model.draft?.final} from the take (right-click)` : 'output resolution — the cost estimate follows it'} />
        </div>
        {/* list 17: Seedance 2.5's Draft — greyed elsewhere with the reason (stable-board law) */}
        <div style={{ paddingBottom: 5 }}>
          <label
            title={model.draft ? `draft = a cheap 480p version first. Right-click the take to finish the same video at ${model.draft.final} (about $${model.draft.finalPerSec.toFixed(2)} a second), within ${DRAFT_DAYS} days` : `${model.label} has no draft mode — Seedance 2.5 on fal and on ModelArk has it`}
            style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: model.draft ? 'pointer' : 'default', opacity: model.draft ? 1 : 0.45 }}
          >
            <input type="checkbox" checked={isDraft} disabled={!model.draft} onChange={(e) => setDraft(e.target.checked)} />
            <span className="lb" style={{ margin: 0 }}>draft</span>
          </label>
        </div>
        <div style={takeHL('aspect')} onDragOver={takeOver('aspect')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('aspect', e)}>
          <div className="lb">aspect</div>
          <Dropdown value={aspect} options={withCurrent(model.aspectRatios, aspect).map((a) => ({ value: a, label: aspectLabel(a) }))} onChange={setAspect} style={{ width: 104 }} title="output aspect ratio — auto follows the first reference" />
        </div>
        {/* seed (his order 2026-09-01): between aspect and audio · LTX-only, greyed elsewhere
            with the reason (stable-board law) · 0 = random, any number = pinned noise */}
        <div style={{ opacity: isLocal ? 1 : 0.45 }} title={isLocal ? '0 = random every take · any number = the same noise every render (A/B tests, LoRA reads)' : `${model.label} rolls its own noise — seed pinning is for the local engines`}>
          <div className="lb">seed</div>
          {/* the FRAME is the Dropdown trigger's exact recipe (same border/padding/font) so the
              row sits at ONE height — the input inside is bare (house-sizes law, ch. 03) */}
          <div style={{ background: 'var(--field)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', width: 92 }}>
            <input
              type="text"
              value={seed}
              disabled={!isLocal}
              onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, '') || '0')}
              style={{ background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, width: '100%', fontSize: 12, lineHeight: '15px', height: 15, color: 'var(--txt-hi)', fontFamily: 'inherit' }}
            />
          </div>
        </div>
        <div style={{ ...takeHL('audio'), paddingBottom: 5 }} onDragOver={takeOver('audio')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('audio', e)}>
          <label title={model.audioToggle ? 'render sound with the video (the engine generates it natively)' : `${model.label} always renders audio — no switch`} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: model.audioToggle ? 'pointer' : 'default', opacity: model.audioToggle ? 1 : 0.55 }}>
            <input type="checkbox" checked={model.audioToggle ? audio : true} disabled={!model.audioToggle} onChange={(e) => setAudio(e.target.checked)} />
            <span className="lb" style={{ margin: 0 }}>audio</span>
          </label>
        </div>
      </div>

      {/* MiniMax H3 local (MINIMAX-H3-LOCAL-SPEC §3 / §4.4): encoder · upscale + factor · speed
          kernels · the engine's own lora set as three rows (Image Gen's unleashed row, ×3).
          Stable board: visible, greyed with the reason off-H3, values kept. */}
      {(() => {
        const isH3 = engine === 'h3local'
        const off = isH3 ? {} : { opacity: 0.45, pointerEvents: 'none' as const }
        const encOpts: DropdownOption[] = h3St.encoders.map((e) => ({ value: e.id, label: e.label.replace(/^encoder /, '') }))
        const setRow = (k: keyof H3LoraSet, patch: Partial<{ on: boolean; w: number }>): void => setH3Set((s) => ({ ...s, [k]: { ...s[k], ...patch } }))
        const rows: { k: keyof H3LoraSet; label: string; title: string }[] = [
          { k: 'turbo', label: 'turbo', title: 'ref2v turbo 4-step — 6 steps instead of 20, on every pass (the workflow: ×1)' },
          { k: 'lms', label: 'lms', title: 'sharpens, keeps it photoreal — the final pass (the workflow: ×0.5)' },
          { k: 'realism', label: 'realism', title: 'realism-people — the final pass (the workflow: ×1); its trigger word r34l1sm rides the prompt while on' }
        ]
        return (
          <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', ...off }} title={isH3 ? undefined : 'MiniMax H3 (local) only'}>
            <div>
              <div className="lb">encoder</div>
              <Dropdown
                value={h3Encoder ?? h3St.encoders[0]?.id ?? ''}
                options={encOpts.length ? encOpts : [{ value: '', label: 'none installed' }]}
                disabled={!encOpts.length}
                onChange={(v) => setH3Encoder(v || undefined)}
                style={{ minWidth: 100 }}
                title="the prompt + picture reader — int8 = best (the workflow's), nvfp4 = smaller; only installed ones list"
              />
            </div>
            <div>
              <div className="lb">upscale</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 24 }}>
                <input type="checkbox" checked={h3Upscale} onChange={(e) => setH3Upscale(e.target.checked)} title="the second pass renders the first pass bigger — sharper, slower, more VRAM" />
                <Dropdown
                  value={String(h3UpscaleBy)}
                  options={[{ value: '1.25', label: '×1.25' }, { value: '1.5', label: '×1.5' }]}
                  disabled={!h3Upscale}
                  onChange={(v) => setH3UpscaleBy(Number(v))}
                  style={{ minWidth: 70 }}
                  title="1.25 = the workflow file's live value · 1.5 = the video's text (heavier, nearer the Blackwell noise line)"
                />
              </div>
            </div>
            <div>
              <div className="lb">speed kernels</div>
              <Dropdown
                value={h3Kernels}
                options={[{ value: 'off', label: 'off' }, { value: 'sage', label: 'sage' }, { value: 'sol', label: 'sol-attn' }]}
                disabled={!h3St.kernels}
                onChange={(v) => setH3Kernels(v as 'off' | 'sage' | 'sol')}
                style={{ minWidth: 90 }}
                title={h3St.kernels ? 'off = exact attention · sage = int8 attention, near-exact, lighter · sol-attn = sparse attention, fastest (a Comfy issue reports artifacts with the turbo lora)' : 'install the speed kernels row in the Models card first'}
              />
            </div>
            <div style={{ flexBasis: '100%', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {rows.map((r) => (
                <span key={r.k} title={r.title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-hi)', opacity: h3Set[r.k].on ? 1 : 0.45 }}>
                  <input type="checkbox" checked={h3Set[r.k].on} onChange={(e) => setRow(r.k, { on: e.target.checked })} />
                  <span>{r.label}</span>
                  <input type="range" min={0} max={2} step={0.05} value={h3Set[r.k].w} disabled={!h3Set[r.k].on} onChange={(e) => setRow(r.k, { w: Number(e.target.value) })} style={{ width: 60, accentColor: 'var(--amber)' }} />
                  <span style={{ color: 'var(--muted)', minWidth: 26, textAlign: 'right' }}>{h3Set[r.k].w.toFixed(2)}</span>
                </span>
              ))}
            </div>
          </div>
        )
      })()}

      {/* LORAS (spec §7 → MINIMAX-H3-LOCAL-SPEC §4.1): Image Gen's block, one copy (ui/LoraChips) —
          the switch, chips with weight sliders, ＋ lora opens the side panel; greyed with the
          reason off the local engines, picks kept; trigger chips LOAD-BEARING. */}
      <LoraChips
        on={loraOn}
        onToggle={setLoraOn}
        picks={loras}
        labelOf={(name) => folderRows.find((r) => r.rel === name)?.name ?? name.split('/').pop()?.replace(/\.safetensors$/i, '') ?? name}
        titleOf={(name, i) => (!folderRows.some((r) => r.rel === name) ? `${name} — not in your folders any more` : loraFits(name) ? `${i + 1} · ${name}` : `${name} — made for the other local model: parked, not sent with this one`)}
        onWeight={(i, w) => setLoras((l) => l.map((x, j) => (j === i ? { ...x, weight: w } : x)))}
        onRemove={(i) => setLoras((l) => l.filter((_, j) => j !== i))}
        onAdd={() => setSideOpen(true)}
        disabled={!isLocal}
        disabledWhy="loras render on the local engines only — LTX 2.5 and MiniMax H3"
        triggerWords={loraOn ? liveLoras.flatMap((l) => folderRows.find((r) => r.rel === l.name)?.triggerWords ?? []) : []}
        haystack={freeform}
        onInsert={(w) => setFreeform((f) => (f.trim() ? `${w}, ${f}` : w))}
      />
      </>)}

      {sec('prompt', <span {...(selectedClipId ? tetherAttr('clip', selectedClipId, 'prompt') : {})}>prompt</span>, <>
      {/* the refs float above the prompt (user design 2026-09-01) — chips by type, dbl-click = editor */}
      {refStrip}
      <div className="field" style={{ position: 'relative' }}>
        <div className="lb" title="type @ in the prompt to insert a ref · drag a Library image in to drop its @name at the caret" style={{ display: 'flex', alignItems: 'center' }}>
          prompt
          <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} title="the structured fields — scene · characters · production notes, plus the generated preview" onClick={() => setExpanded((v) => !v)}>
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
          placeholder="your prompt — @ for refs"
          title="your prompt (kept on top, never overwritten) — drag a Library image to drop its @name · drag a T-chip to restore a take's prompt"
          rows={3}
          style={{ ...ctl, width: '100%', resize: 'vertical', ...takeHL('prompt'), ...fieldChrome(fieldMeta, 'freeform', freeformFocus.focused) }}
          {...(selectedClipId ? tetherAttr('clip', selectedClipId, 'freeform') : {})}
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
        {/* NEGATIVE — the engine's negative channel, never your prompt. Real only on the
            bf16 pick (CFG 4); distilled runs CFG 1 and ignores it, fal engines have none.
            Stable board: always visible, dims with the reason, value kept while greyed. */}
        {(() => {
          const devPicked = engine === 'ltx25' && ltxSize === 'ltx-2.5-full'
          return (
            <input
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="negative — what must never appear"
              disabled={!devPicked}
              title={devPicked ? "goes to the engine's negative field, never your prompt" : 'negative works on LTX 2.5 (full dev bf16) only — distilled sizes and fal engines ignore it'}
              style={{ ...ctl, width: '100%', marginTop: 4, fontSize: 11, ...(devPicked ? {} : { opacity: 0.4 }) }}
            />
          )
        })()}
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

      {sec('beats', <span {...(selectedClipId ? tetherAttr('clip', selectedClipId, 'beats') : {})}>beats</span>,
      <div style={takeHL('beats')} onDragOver={takeOver('beats')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('beats', e)} title="drag a T-chip here to restore that take's beats (rescaled to the current duration)">
        <Beats
          beats={beats}
          duration={durNum}
          onChange={onBeatsChange}
          refImageUrl={beatRefUrl}
          titles={libImages.map((i) => i.title)}
          owner={selectedClipId ? { clipId: selectedClipId } : undefined}
          onBlock={() => void blockScene()}
          blockBusy={blockBusy}
        />
      </div>
      )}


      {(lint.length > 0 || check.errors.length > 0 || check.warnings.length > 0 || flags.length > 0) && (
        <div className="field" style={{ fontSize: 10 }}>
          {check.errors.map((w, i) => (
            <div key={'e' + i} style={{ color: 'var(--bad)' }}>✕ {w}</div>
          ))}
          {/* list 31: the preflight — facts about the assembled prompt, said before the money leaves */}
          {flags.map((w, i) => (
            <div key={'f' + i} data-flag style={{ color: 'var(--amber)' }} title="a flag before you spend: a fact about what the render will send, not a block">⚑ {w}</div>
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
                  ? `estimated fal cost: ${renderRes}${isDraft ? ' draft' : ''}${talkSec != null ? ` × ${durNum.toFixed(1)}s (the voice)` : duration === 'auto' ? ', auto duration assumed 5s' : ` × ${durNum}s`} @ $${rate.toFixed(4)}/s (${model.label}, standard tier). Actual may vary.`
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

      {pvCtx && (
        <ContextMenu
          x={pvCtx.x}
          y={pvCtx.y}
          entries={[
            {
              label: <>📷 current frame → image ref</>,
              disabled: isI2v,
              title: isI2v ? 'i2v has no @refs — use → Library, then set it as a frame' : 'grabs this frame into the Library and adds it to this clip’s image refs (@name joins the prompt)',
              onClick: () => void grabPreviewFrame('ref')
            },
            {
              label: <>📷 current frame → Library</>,
              title: 'grabs this frame into the Library only',
              onClick: () => void grabPreviewFrame('lib')
            }
          ]}
          onClose={() => setPvCtx(null)}
        />
      )}
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
                {disabledLast(libImages).map((im) => (
                  <span key={im.id} style={dimStyle(im.disabled)} title={im.disabled ? 'disabled in the Library — still pickable' : undefined}>
                    <Thumbnail file={im.file} label={im.title} w={104} h={66} onClick={() => assign(im.file)} />
                  </span>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
    {loraSide}
    </div>
  )
}
