import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { ClipFields } from './ClipFields'
import { Beats } from './Beats'
import { Thumbnail } from '../Thumbnail'
import { mediaUrl } from '../media'
import { focusAudio, muteAll, subAudio } from '../audioBus'
import { buildYaml, buildCombined, lintFields, EMPTY_SCENE, EMPTY_PRODUCTION, beatRefFile } from '../emitYaml'
import { MODELS, modelFor, DEFAULT_ENGINE } from '../../../shared/models'
import { validateForm } from '../lib/validation'
import { MIME_IMAGE, MIME_TAKE } from '../lib/dragDrop'
import { ctl } from '../ui/controls'

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
  const [busy, setBusy] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const lastUrl = useRef<string | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const loadingRef = useRef(false) // true while populating the form from a clip → suppress auto-save
  const beatsDirtyRef = useRef(false) // true when beats were edited HERE since load → only then persist them
  const [pvMuted, setPvMuted] = useState(true) // take preview is muted by default
  const [pvPlaying, setPvPlaying] = useState(true)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [picker, setPicker] = useState<'ref' | 'start' | 'end' | null>(null)
  const [dragTarget, setDragTarget] = useState<'ref' | 'start' | 'end' | null>(null)

  const isI2v = mode === 'i2v'
  const model = modelFor(engine) // the active engine's capability descriptor drives the fields below
  const libImages = project?.images ?? []
  const titleOf = (file: string): string | undefined => libImages.find((i) => i.file === file)?.title
  const fileOfTitle = (title: string): string | undefined => libImages.find((i) => i.title === title)?.file

  const structured = { scene, characters, beats, production, duration }
  const yamlPreview = buildYaml(structured)
  const combined = buildCombined(freeform, structured)
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

  // estimated fal cost = $/sec(resolution) × duration ('auto' assumed 5s, flagged with *)
  const durNum = duration === 'auto' ? 5 : parseFloat(duration) || 0
  const rate = model.pricePerSec[resolution] ?? Object.values(model.pricePerSec)[0] ?? 0
  const estCost = rate * durNum
  const estStr = estCost > 0 ? `~$${estCost.toFixed(2)}${duration === 'auto' ? '*' : ''}` : ''

  const playBytes = (b: Uint8Array): void => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current)
    const u = URL.createObjectURL(new Blob([b as unknown as BlobPart], { type: 'video/mp4' }))
    lastUrl.current = u
    setVideoUrl(u)
  }
  // play an existing take by streaming it (media://) instead of reading the whole file over IPC
  const showVideoFile = (file: string): void => {
    if (lastUrl.current) {
      URL.revokeObjectURL(lastUrl.current)
      lastUrl.current = null
    }
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

  useEffect(() => {
    const off = window.vidancer.onRenderProgress((m) => setStatus(m))
    return off
  }, [])

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
    loadingRef.current = true // suppress auto-save while we populate from the clip
    beatsDirtyRef.current = false // freshly loaded → beats not locally edited yet
    const pd = c.promptData as PromptData & { prompt?: string }
    const fileOfId = (id?: string): string | undefined => (id ? project.images.find((i) => i.id === id)?.file : undefined)
    setClipName(c.name)
    setEngine(pd.engine ?? DEFAULT_ENGINE)
    setMode(pd.mode)
    setFreeform(pd.freeform ?? pd.prompt ?? '')
    setScene(pd.scene ?? { ...EMPTY_SCENE })
    setCharacters(pd.characters ?? [])
    setBeats(pd.beats ?? [])
    setProduction(pd.production ?? { ...EMPTY_PRODUCTION })
    setDuration(pd.duration)
    setResolution(pd.resolution)
    setAspect(pd.aspectRatio)
    setAudio(pd.generateAudio)
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
    const slot = editTimelineIndex != null ? project.timeline?.[editTimelineIndex] : undefined
    const inSlot = !!slot && slot.clipId === selectedClipId
    const shownTakeId = (inSlot ? slot!.takeId : undefined) ?? c.keeperTakeId
    const take = c.takes.find((t) => t.id === shownTakeId) ?? c.takes[c.takes.length - 1]
    if (take) showVideoFile(take.file)
    else setVideoUrl(null) // storyboard clip — nothing rendered yet
    setStatus(inSlot ? `timeline clip — slot ${editTimelineIndex! + 1}` : 'loaded: ' + c.name)
    // loadingRef stays true; the auto-save effect consumes it (skips exactly the load-triggered save)
    // reads `project` via closure on purpose — only reload when the selection changes, not on every edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId, editTimelineIndex])

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

  const newClip = (): void => {
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
      generateAudio: audio
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
  }, [engine, mode, freeform, scene, characters, beats, production, refImages, startFile, endFile, duration, resolution, aspect, audio, selectedClipId])

  const render = async (): Promise<void> => {
    if (check.errors.length) return setStatus('fix first: ' + check.errors[0])
    setBusy(true)
    setStatus('starting…')
    const r = await window.vidancer.render({
      engine,
      mode,
      prompt: combined,
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
      clipId: selectedClipId ?? undefined,
      name: clipName || undefined
    })
    setBusy(false)
    if (r.ok && r.bytes && r.delta) {
      useStore.getState().applyDelta(r.delta)
      if (editingSlot && editTimelineIndex != null && r.takeId) {
        // editing a timeline slot: adopt the freshly rendered take into THIS slot only
        const tl = useStore.getState().project?.timeline ?? []
        void setTimelineItems(tl.map((x, j) => (j === editTimelineIndex ? { ...x, takeId: r.takeId as string } : x)))
      } else if (r.clipId) {
        selectClip(r.clipId)
      }
      playBytes(r.bytes)
      setStatus('done ✓ — saved to bin')
      void useStore.getState().refreshCredit()
    } else {
      setStatus('error: ' + (r.error ?? 'unknown'))
    }
  }

  const selClip = selectedClipId ? project?.clips.find((c) => c.id === selectedClipId) : undefined
  const takes = selClip?.takes ?? []
  const editingSlot =
    editTimelineIndex != null && project?.timeline?.[editTimelineIndex]?.clipId === selectedClipId
  const slotTakeId = editingSlot
    ? project!.timeline[editTimelineIndex!].takeId ?? selClip?.keeperTakeId
    : selClip?.keeperTakeId

  return (
    <div className="vd-panel vd-scroll vd-inspector">
      <div className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={clipName}
          onChange={(e) => setClipName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
          placeholder="clip name"
          style={{ ...ctl, flex: 1 }}
        />
        <span className="btn vd-hbtn" onClick={newClip}>+ new</span>
      </div>

      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div className="lb">model</div>
          <select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} style={ctl} title="generation engine — switching keeps ALL inputs; unsupported ones grey out">
            {Object.values(MODELS).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
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

      <div className="field" style={{ position: 'relative' }}>
        <div className="lb" style={{ display: 'flex', alignItems: 'center' }}>
          prompt <span style={{ color: 'var(--dim)' }}>&nbsp;— type @ to insert a ref</span>
          <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '▾ fields' : '▸ fields'}
          </span>
        </div>
        <textarea
          ref={taRef}
          value={freeform}
          onChange={onFreeform}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onPromptDrop}
          placeholder="your prompt (kept on top, never overwritten) — drag a library image to drop its @name"
          rows={3}
          style={{ ...ctl, width: '100%', resize: 'vertical' }}
        />
        {mentionMatches.length > 0 && (
          <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, background: '#16161a', border: '1px solid var(--line2)', borderRadius: 4, maxHeight: 160, overflow: 'auto' }}>
            {mentionMatches.map((im) => (
              <div
                key={im.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(im.title)
                }}
                style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: '#e7c98c' }}
              >
                {im.title}
              </div>
            ))}
          </div>
        )}
        {expanded && yamlPreview && (
          <>
            <div className="lb" style={{ marginTop: 8 }}>↓ generated from fields (sent under your prompt)</div>
            <pre style={{ ...ctl, width: '100%', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', color: '#bfe0c0', margin: 0 }}>{yamlPreview}</pre>
          </>
        )}
      </div>

      {expanded && (
        <ClipFields
          scene={scene}
          setScene={setScene}
          characters={characters}
          setCharacters={setCharacters}
          production={production}
          setProduction={setProduction}
        />
      )}

      <Beats
        beats={beats}
        duration={durNum}
        onChange={onBeatsChange}
        refImageUrl={beatRefUrl}
        titles={libImages.map((i) => i.title)}
      />

      {/* images in use for THIS clip — drag from the Library, or use the picker */}
      {isI2v ? (
        <div className="field">
          <div style={{ display: 'flex', gap: 10 }}>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragTarget('start')
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(e) => onDropImage(e, 'start')}
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
                setDragTarget('end')
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(e) => model.endFrame && onDropImage(e, 'end')}
              style={model.endFrame ? undefined : { opacity: 0.35, pointerEvents: 'none' }}
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
              setDragTarget('ref')
            }}
            onDragLeave={() => setDragTarget(null)}
            onDrop={(e) => onDropImage(e, 'ref')}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, outline: dragTarget === 'ref' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
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
      )}

      <div className="field" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="lb">duration</div>
          <select value={duration} onChange={(e) => setDuration(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.durations, duration).map((d) => (<option key={d}>{d}</option>))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div className="lb">resolution</div>
          <select value={resolution} onChange={(e) => setResolution(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.resolutions, resolution).map((r) => (<option key={r}>{r}</option>))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div className="lb">aspect</div>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.aspectRatios, aspect).map((a) => (<option key={a}>{a}</option>))}
          </select>
        </div>
      </div>

      <div className="field">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: model.audioToggle ? 'pointer' : 'default', opacity: model.audioToggle ? 1 : 0.55 }}>
          <input type="checkbox" checked={model.audioToggle ? audio : true} disabled={!model.audioToggle} onChange={(e) => setAudio(e.target.checked)} />
          <span className="lb" style={{ margin: 0 }}>
            {model.audioToggle ? 'generate audio (native)' : `audio: always on (${model.label})`}
          </span>
        </label>
      </div>

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
          opacity: busy || check.errors.length ? 0.5 : 1,
          pointerEvents: busy ? 'none' : 'auto'
        }}
        onClick={render}
      >
        {busy
          ? 'rendering…'
          : `${selectedClipId ? '▶ Render (adds a take)' : '▶ Render (new clip)'} · ${model.label}${estStr ? ' · ' + estStr : ''}`}
      </span>

      {takes.length > 0 && (
        <div className="field" style={{ marginTop: 10 }}>
          <div className="lb">{editingSlot ? `takes — sets this slot (#${editTimelineIndex! + 1})` : 'takes — click = keeper'}</div>
          {editingSlot && takes.length > 1 && (
            <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 6 }}>
              ▦ the take you pick applies to THIS slot only — all other edits affect the whole clip.
            </div>
          )}
          <div className="vd-slots">
            {takes.map((t, i) => (
              <span
                className={'vd-slot' + (t.id === slotTakeId ? ' filled' : '')}
                key={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(MIME_TAKE, JSON.stringify({ clipId: selClip?.id, takeId: t.id }))}
                onClick={() => {
                  if (editingSlot && project?.timeline && editTimelineIndex != null) {
                    void setTimelineItems(project.timeline.map((x, j) => (j === editTimelineIndex ? { ...x, takeId: t.id } : x)))
                  } else if (selClip) {
                    void setKeeper(selClip.id, t.id)
                  }
                  playTake(t.file)
                }}
                title={editingSlot ? 'set this take for this timeline slot' : 'click = make keeper · drag to Bin = new clip from this take'}
              >
                T{i + 1}{t.id === slotTakeId ? ' ★' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="vd-hint" style={{ color: status.startsWith('error') ? 'var(--bad)' : 'var(--muted)' }}>{status}</p>

      {videoUrl && (
        <div className="field" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="lb" style={{ margin: 0 }}>preview</span>
            <span className="btn vd-hbtn" onClick={togglePvPlay} title="play / pause">{pvPlaying ? '⏸' : '▶'}</span>
            <span className="btn vd-hbtn" onClick={togglePvMute} title="mute / unmute">{pvMuted ? '🔇' : '🔊'}</span>
            <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setPreview(videoUrl)}>⤢ preview</span>
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
                <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void pickerImport()}>⬆ import new</span>
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
