import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { ClipFields } from './ClipFields'
import { Beats, fitArr } from './Beats'
import { Thumbnail } from '../Thumbnail'
import { mediaUrl } from '../media'
import { focusAudio, muteAll, subAudio } from '../audioBus'
import { buildYaml, buildNatural, buildCombinedFor, applyRefTags, lintFields, EMPTY_SCENE, EMPTY_PRODUCTION, beatRefFile } from '../emitYaml'
import { MODELS, modelFor, DEFAULT_ENGINE } from '../../../shared/models'
import { validateForm } from '../lib/validation'
import { MIME_IMAGE, MIME_TAKE } from '../lib/dragDrop'
import { activeItems } from '../lib/timelineUtils'
import { ctl } from '../ui/controls'
import { toast } from '../ui/Toast'
import { openClipEdit } from '../panelBus'
import { Ic, Link2, ImageDown, Play, Pause, Volume2, VolumeX, Maximize2 } from '../ui/icons'

// keep the stored value selectable even when the active engine doesn't list it — the value is
// preserved (store-everything), validation flags it, and switching engines back restores validity
const withCurrent = (options: string[], current: string): string[] =>
  options.includes(current) ? options : [current, ...options]

export function RenderPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const renameClip = useStore((s) => s.renameClip)
  const importToLibrary = useStore((s) => s.importToLibrary)
  const setKeeper = useStore((s) => s.setKeeper)
  const editTimelineIndex = useStore((s) => s.editTimelineIndex)
  const setTimelineItems = useStore((s) => s.setTimelineItems)
  const createClip = useStore((s) => s.createClip)
  const saveClipPromptData = useStore((s) => s.saveClipPromptData)
  const autoTime = useStore((s) => s.autoTime)
  const renameSignal = useStore((s) => s.renameSignal)
  const fileSwap = useStore((s) => s.fileSwap)
  const undoTick = useStore((s) => s.undoTick)

  const [clipName, setClipName] = useState('')
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE)
  const [mode, setMode] = useState<'ref2v' | 'i2v'>('ref2v')
  const [freeform, setFreeform] = useState('')
  const [scene, setScene] = useState<SceneFields>({ ...EMPTY_SCENE })
  const [characters, setCharacters] = useState<CharacterField[]>([])
  const [beats, setBeats] = useState<BeatField[]>([])
  const [production, setProduction] = useState<ProductionFields>({ ...EMPTY_PRODUCTION })
  const [expanded, setExpanded] = useState(false)
  const [refImages, setRefImages] = useState<string[]>([])
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
  const adoptRef = useRef(false) // '+ new' adopted typed content → the next load KEEPS the form (no wipe)
  const projDirRef = useRef<string | undefined>(undefined) // which project the form's content belongs to
  const lastRenameN = useRef(0) // last rename-signal seen (rewrite our LIVE text once per rename)
  const lastSwapN = useRef(0) // last file-swap signal seen (primary version change → repoint live refs)
  const [pvMuted, setPvMuted] = useState(true) // take preview is muted by default
  const [pvPlaying, setPvPlaying] = useState(true)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const pendingFocusRef = useRef(false) // double-clicked a link chip → focus the prompt once the target loads
  const [preview, setPreview] = useState<string | null>(null)
  const [picker, setPicker] = useState<'ref' | 'start' | 'end' | null>(null)
  const [dragTarget, setDragTarget] = useState<'ref' | 'start' | 'end' | null>(null)
  const [takeDrop, setTakeDrop] = useState<string | null>(null) // field a dragged T-chip is hovering
  const [closedSecs, setClosedSecs] = useState<Set<string>>(new Set()) // collapsed section landmarks
  const [promptLink, setPromptLink] = useState<{ clipId: string; pos: 'before' | 'after' } | null>(null)
  const [linkPicker, setLinkPicker] = useState(false) // the "link a clip's prompt" chooser is open
  const [fieldLinks, setFieldLinks] = useState<Record<string, string>>({}) // field path → source clip id

  const isI2v = mode === 'i2v'
  const model = modelFor(engine) // the active engine's capability descriptor drives the fields below
  const libImages = project?.images ?? []
  const titleOf = (file: string): string | undefined => libImages.find((i) => i.file === file)?.title
  const fileOfTitle = (title: string): string | undefined => libImages.find((i) => i.title === title)?.file

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
  // per-field links: a field can borrow another clip's SAME field, then your own text is appended.
  const readField = (pd: PromptData, path: string): string => {
    const [g, k] = path.split('.')
    const grp = g === 'scene' ? pd.scene : g === 'production' ? pd.production : undefined
    return grp ? (grp as unknown as Record<string, string>)[k] ?? '' : ''
  }
  const splice = (linkedVal: string, mine: string): string => (mine ? `${linkedVal} ${mine}`.trim() : linkedVal)
  const resolveScene = (s: SceneFields): SceneFields => {
    const out: SceneFields = { ...s }
    for (const k of Object.keys(s) as (keyof SceneFields)[]) {
      const src = fieldLinks[`scene.${k}`] ? project?.clips.find((c) => c.id === fieldLinks[`scene.${k}`]) : undefined
      if (src) out[k] = splice(src.promptData.scene?.[k] ?? '', s[k] ?? '')
    }
    return out
  }
  const resolveProduction = (p: ProductionFields): ProductionFields => {
    const out: ProductionFields = { ...p }
    for (const k of Object.keys(p) as (keyof ProductionFields)[]) {
      const src = fieldLinks[`production.${k}`] ? project?.clips.find((c) => c.id === fieldLinks[`production.${k}`]) : undefined
      if (src) out[k] = splice(src.promptData.production?.[k] ?? '', p[k] ?? '')
    }
    return out
  }
  const structured = { scene, characters, beats, production, duration } // local (what you typed) — drives lint
  const effectiveStructured = { scene: resolveScene(scene), characters, beats, production: resolveProduction(production), duration }
  // emit in the ACTIVE engine's flavor — lint, mention warnings and the preview must all judge the
  // prompt that will actually be sent, not a Seedance YAML the model never sees
  const promptStyle = modelFor(engine).promptStyle ?? 'yaml'
  const yamlPreview = promptStyle === 'natural' ? buildNatural(effectiveStructured) : buildYaml(effectiveStructured)
  const combined = buildCombinedFor(promptStyle, effectiveFreeform, effectiveStructured)
  // the bundle the fields use to pick/show/open per-field links
  const fieldLinking = {
    links: fieldLinks,
    clipName: (id: string): string => project?.clips.find((c) => c.id === id)?.name ?? '(removed)',
    preview: (id: string, path: string): string => {
      const c = project?.clips.find((x) => x.id === id)
      return c ? readField(c.promptData, path) : ''
    },
    pickList: (project?.clips ?? []).filter((c) => c.id !== selectedClipId).map((c) => ({ id: c.id, name: c.name })),
    setLink: (path: string, clipId: string): void => setFieldLinks((m) => ({ ...m, [path]: clipId })),
    clearLink: (path: string): void =>
      setFieldLinks((m) => {
        const n = { ...m }
        delete n[path]
        return n
      }),
    openLink: (clipId: string): void => {
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
    autoTime
  })
  // engine-capability validation: errors BLOCK the render (each would be a paid 422 / silent drop)
  const check = validateForm(
    {
      mode,
      promptEmpty: !combined.trim(),
      refCount: refImages.length,
      hasStart: !!startFile,
      hasEnd: !!endFile,
      duration,
      resolution,
      aspect
    },
    model
  )

  // does the form hold ANYTHING the user typed? (drives the "not in the bin yet" warning and
  // '+ new' adopting the content instead of wiping it)
  const hasContent =
    clipName.trim() !== '' ||
    freeform.trim() !== '' ||
    beats.length > 0 ||
    refImages.length > 0 ||
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
  const estStr = estCost > 0 ? `~$${estCost.toFixed(2)}${duration === 'auto' ? '*' : ''}` : ''

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

  // completion watcher: when a queued gen for THIS panel's clip finishes, preview it (progress
  // itself lives in the Queue panel now — renders are queued, not awaited)
  const queue = useStore((s) => s.queue)
  useEffect(() => {
    const job = queue.find((j) => j.kind === 'gen' && j.status === 'done' && !j.consumed && j.resultClipId)
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
  }, [videoUrl])
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
    setMode(pd.mode === 'v2v' ? 'ref2v' : pd.mode) // edit clips belong to Clip Edit — never render them as v2v from here
    setFreeform(pd.freeform ?? pd.prompt ?? '')
    setScene(pd.scene ?? { ...EMPTY_SCENE })
    setCharacters(pd.characters ?? [])
    setBeats(pd.beats ?? [])
    setProduction(pd.production ?? { ...EMPTY_PRODUCTION })
    setDuration(pd.duration)
    setResolution(pd.resolution)
    setAspect(pd.aspectRatio)
    setAudio(pd.generateAudio)
    setPromptLink(pd.promptLink ?? null)
    setLinkPicker(false)
    setFieldLinks(pd.fieldLinks ?? {})
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
    if (beatsDirtyRef.current) return // mid-edit HERE — our debounced save is the newest intent, keep it
    setBeats((curr) =>
      curr.length === storeBeats.length && JSON.stringify(curr) === JSON.stringify(storeBeats) ? curr : storeBeats
    )
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
  // beats also accept @refs: any @title in a beat's text joins the clip's ref library (ref2v)
  const onBeatsChange = (next: BeatField[]): void => {
    beatsDirtyRef.current = true // user edited beats in the Inspector → safe to persist them
    setBeats(next)
    if (!isI2v) {
      const text = next
        .map((b) => [b.camera, b.action, b.lighting, b.dialogue, b.vfx, b.reaction, b.sfx].filter(Boolean).join(' '))
        .join(' ')
      const files = (text.match(/@\w+/g) ?? []).map((t) => fileOfTitle(t)).filter((f): f is string => !!f)
      if (files.length) setRefImages((prev) => Array.from(new Set([...prev, ...files])))
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
    // two-way @refs: any @title in the prompt that matches a library image joins this clip's refs
    if (!isI2v) {
      const files = (val.match(/@\w+/g) ?? []).map((t) => fileOfTitle(t)).filter((f): f is string => !!f)
      if (files.length) setRefImages((prev) => Array.from(new Set([...prev, ...files])))
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
      duration,
      resolution,
      aspectRatio: aspect,
      generateAudio: audio,
      promptLink: promptLink ?? undefined,
      fieldLinks: Object.keys(fieldLinks).length ? fieldLinks : undefined
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
      void saveClipPromptData(id, payload)
      if (sentBeats) beatsDirtyRef.current = false
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, mode, freeform, scene, characters, beats, production, refImages, startFile, endFile, duration, resolution, aspect, audio, promptLink, fieldLinks, selectedClipId])

  const render = (): void => {
    if (check.errors.length) return setStatus('fix first: ' + check.errors[0])
    // `combined` is already in this engine's flavor — only the ref-tag rewrite is outgoing-only
    // (the visible prompt keeps @titles; the wire prompt binds refs as <IMAGE_REF_n>)
    const m = modelFor(engine)
    let outPrompt = combined
    if (m.refTagPrompt && !isI2v && refImages.length) outPrompt = applyRefTags(outPrompt, refImages.map((f) => titleOf(f) ?? ''))
    // renders QUEUE (one at a time, in order) — the Queue panel owns progress/cancel from here.
    // Slot adoption is captured by stable item id NOW; the runner applies it when the take lands.
    useStore.getState().enqueueRender({
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
        duration,
        resolution,
        aspectRatio: aspect,
        generateAudio: audio,
        promptLink: promptLink ?? undefined,
        fieldLinks: Object.keys(fieldLinks).length ? fieldLinks : undefined,
        clipId: selectedClipId ?? undefined,
        name: clipName || undefined
      }
    })
    setStatus('queued → watch the Queue panel')
  }

  const selClip = selectedClipId ? project?.clips.find((c) => c.id === selectedClipId) : undefined
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
      void setTimelineItems(
        tlItems.map((x, j) =>
          j === editTimelineIndex ? { ...x, takeId: undefined, useRecipe: true, inSec: undefined, outSec: undefined } : x
        )
      )
    } else {
      useStore.getState().setPreviewRecipe(true) // bin mode → the Clip Monitor shows the live recipe
    }
    setVideoUrl(null) // editor preview drops to the recipe (storyboard) view
  }
  // ⊢/⊣: add a LIVE still of this timeline instance's first/last frame to the Library — it
  // re-extracts itself whenever the instance's frame moves (trim/slice/take swap/undo)
  const addDynamicStill = async (edge: 'first' | 'last'): Promise<void> => {
    if (!editingSlot || editTimelineIndex == null || slotUsesRecipe) return
    const item = tlItems[editTimelineIndex]
    if (!item) return
    const r = await window.vidancer.imageAddDynamicStill(item.id, edge)
    if (r) {
      useStore.getState().applyDelta(r.delta)
      const title = r.delta.images?.[0]?.title ?? ''
      toast(`${title} → Library — live ${edge} frame (tracks this clip's edits)`, { kind: 'ok' })
    } else {
      toast('couldn’t grab that frame (render a take first?)', { kind: 'error' })
    }
  }

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

      {sec('setup', 'setup — model · mode · output', <>
      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 auto', ...takeHL('engine') }} onDragOver={takeOver('engine')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('engine', e)}>
          <div className="lb">model</div>
          <select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} style={ctl} title="generation engine — switching keeps ALL inputs; unsupported ones grey out">
            {Object.values(MODELS).map((m) => (
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
          onChange={onFreeform}
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
          style={{ ...ctl, width: '100%', resize: 'vertical', ...takeHL('prompt') }}
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
            <pre style={{ ...ctl, width: '100%', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', color: 'color-mix(in srgb, var(--ok) 55%, var(--txt-hi))', margin: 0 }}>{yamlPreview}</pre>
          </>
        )}
      </div>

      {expanded && (
        <div style={takeHL('fields')} onDragOver={takeOver('fields')} onDragLeave={() => setTakeDrop(null)} onDrop={(e) => onTakeDrop('fields', e)}>
          <ClipFields
            scene={scene}
            setScene={setScene}
            characters={characters}
            setCharacters={setCharacters}
            production={production}
            setProduction={setProduction}
            linking={fieldLinking}
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
          <div className="lb">references in use (@refs, ≤{model.maxRefImages}) <span style={{ color: 'var(--dim)' }}>— yellow = not @mentioned in the prompt</span></div>
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
            <span className="vd-slot" onClick={() => setPicker('ref')}>+ add</span>
          </div>
        </div>
      ))}

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

      {takes.length > 0 && sec('takes', 'takes & versions', (
        <div className="field" style={{ marginTop: 2 }}>
          <div className="lb">
            {editingSlot ? `takes — sets this slot (#${editTimelineIndex! + 1})` : 'takes — click = keeper'}
            <span style={{ color: 'var(--dim)' }}> · drag a T onto any field to restore it from that take</span>
          </div>
          {editingSlot && takes.length > 1 && (
            <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 6 }}>
              ▦ the take you pick applies to THIS slot only — all other edits affect the whole clip.
            </div>
          )}
          <div className="vd-slots">
            {/* C = the live recipe (duration setting + current beats + keyframe) — always first */}
            <span
              className={'vd-slot' + (slotUsesRecipe || (!editingSlot && previewRecipe) ? ' filled' : '')}
              onClick={pickRecipeForSlot}
              title={
                editingSlot
                  ? 'show the LIVE recipe on this timeline slot (duration setting + current beats + keyframe)'
                  : 'preview the live recipe in the Clip Monitor (what the next render will use)'
              }
            >
              C{slotUsesRecipe || (!editingSlot && previewRecipe) ? ' ★' : ''}
            </span>
            {takes.map((t, i) => (
              <span
                className={'vd-slot' + (t.id === slotTakeId ? ' filled' : '')}
                key={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(MIME_TAKE, JSON.stringify({ clipId: selClip?.id, takeId: t.id }))}
                onClick={() => {
                  if (editingSlot && editTimelineIndex != null) {
                    // match the slot by ID against FRESH items — the render-time index can be stale
                    const slotId = tlItems[editTimelineIndex]?.id
                    const cur = activeItems(useStore.getState().project)
                    if (slotId) void setTimelineItems(cur.map((x) => (x.id === slotId ? { ...x, takeId: t.id, useRecipe: undefined } : x)))
                  } else if (selClip) {
                    void setKeeper(selClip.id, t.id)
                    useStore.getState().setPreviewRecipe(false) // back to a take view in the Clip Monitor
                  }
                  playTake(t.file)
                }}
                title={editingSlot ? 'set this take for this timeline slot' : 'click = make keeper · drag to Bin = new clip from this take'}
              >
                T{i + 1}{t.id === slotTakeId ? ' ★' : ''}
              </span>
            ))}
            {takes.length > 0 && selClip && (
              <span
                className="btn vd-hbtn"
                title="edit the ★ take with AI (v2v) — opens Clip Edit as a draft; nothing hits the Bin until it generates"
                onClick={() => {
                  const tid = slotTakeId ?? selClip.keeperTakeId ?? takes[takes.length - 1].id
                  useStore.getState().setEditTarget({ source: { clipId: selClip.id, takeId: tid } })
                  openClipEdit()
                }}
              >
                ⑂ edit
              </span>
            )}
          </div>
          {editingSlot && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <span
                className="btn vd-hbtn"
                style={{ opacity: slotUsesRecipe || takes.length === 0 ? 0.45 : 1 }}
                onClick={() => void addDynamicStill('first')}
                title="add a LIVE still of this instance's FIRST frame to the Library — it re-extracts itself when the trim/slice/take changes"
              >
                ⊢ first frame
              </span>
              <span
                className="btn vd-hbtn"
                style={{ opacity: slotUsesRecipe || takes.length === 0 ? 0.45 : 1 }}
                onClick={() => void addDynamicStill('last')}
                title="add a LIVE still of this instance's LAST frame to the Library — perfect as the next clip's start frame"
              >
                last frame ⊣
              </span>
              <span style={{ fontSize: 9.5, color: 'var(--dim)' }}>live stills — they follow this clip's edits</span>
            </div>
          )}
        </div>
      ))}

      {videoUrl && (
        <div className="field" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="lb" style={{ margin: 0 }}>preview</span>
            <span className="btn vd-hbtn" onClick={togglePvPlay} title="play / pause"><Ic i={pvPlaying ? Pause : Play} size={11} /></span>
            <span className="btn vd-hbtn" onClick={togglePvMute} title="mute / unmute"><Ic i={pvMuted ? VolumeX : Volume2} size={11} /></span>
            <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setPreview(videoUrl)}><Ic i={Maximize2} size={11} /> preview</span>
          </div>
          <div style={{ height: 200, background: '#000', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <video
              ref={previewRef}
              src={videoUrl}
              autoPlay
              loop
              muted={pvMuted}
              onClick={togglePvPlay}
              onPlay={() => setPvPlaying(true)}
              onPause={() => setPvPlaying(false)}
              onVolumeChange={(e) => {
                const v = e.currentTarget
                if (!v.muted) focusAudio(v)
                setPvMuted(v.muted)
              }}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'pointer' }}
            />
          </div>
        </div>
      )}
      </div>

      {/* sticky footer — the render action + live status stay visible no matter how long the form gets */}
      <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--line)', padding: '8px 10px', background: 'var(--bg2)' }}>
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
            display: 'block',
            textAlign: 'center',
            opacity: check.errors.length ? 0.5 : 1
          }}
          onClick={render}
        >
          {`${selectedClipId ? '▶ Render (adds a take)' : '▶ Render (new clip)'} · ${model.label}${estStr ? ' · ' + estStr : ''}`}
        </span>
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
