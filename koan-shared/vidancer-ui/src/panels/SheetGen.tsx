import { useState, useRef, useEffect } from 'react'
import { ResizeHandle } from '../ui/ResizeHandle'
import { vd } from '../api'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { openClipEditor } from '../panelBus'
import { modelFor } from '../shared/models'
import { compileClip, applyRefTags } from '../shared/compile'
import { ctl } from '../ui/controls'
import { Ic, Pencil, Person, Scene, Play, Pause, Volume2, VolumeX } from '../ui/icons'
import { Thumbnail } from '../Thumbnail'
import { FloatPick } from '../ui/FloatPick'
import { toast } from '../ui/Toast'
import { Section, Dropdown, type DropdownOption } from '@koan/shared'
import { encodeEngine, decodeEngine, missingPinOption, modelOptions, viaOptions, familyOf, isFamily, engineForFamily, rememberVia } from '../lib/engineOptions'
import { useLtxReady } from '../lib/ltxReady'
import { modelWizard } from '../lib/modelWizard'

const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }

// ---- Sheet Gen (docs/SHEET-GEN-SPEC-2026-09-08.md): Clip Gen streamlined for ONE purpose —
// turn a source image into a reference sheet through video. The clip is an ordinary Bin clip
// (its fields carry the Screen Test contract, editable in Clip Gen); every render is a take;
// build sheet harvests a take into five pulled views + the 2×2 sheet in the Library. Voice Gen's
// grammar: name row · MODEL · source box · prompt · takes · hero. ----

// which pulled views fill TL,TR,BL,BR — his default front·back·face·detail; side stays a loose view
const PICKS: Record<SheetMode, { label: string; pick: number[] }[]> = {
  character: [
    { label: 'front · back · face · detail', pick: [1, 3, 4, 5] },
    { label: 'front · side · face · detail', pick: [1, 2, 4, 5] },
    { label: 'front · side · back · face', pick: [1, 2, 3, 4] }
  ],
  scene: [
    { label: 'wide · reverse · low · high', pick: [1, 2, 3, 4] },
    { label: 'wide · reverse · low · threshold', pick: [1, 2, 3, 5] },
    { label: 'wide · low · high · threshold', pick: [1, 3, 4, 5] }
  ],
  expression: [
    { label: 'joy · anger · grief · laughter', pick: [1, 2, 3, 4] },
    { label: 'joy · anger · grief · peak', pick: [1, 2, 3, 5] },
    { label: 'anger · grief · laughter · peak', pick: [2, 3, 4, 5] }
  ]
}

// the Nano Banana lane: one image straight to the Library through the image tree (no video)
const NANO = 'nano-banana'
const NANO_PROMPT: Record<SheetMode, string> = {
  character:
    'Make a character reference sheet of this exact character in this exact style: a 2×2 grid — full-body front view, full-body back view, a tight face close-up, and a close-up of one signature detail — on a neutral seamless grey studio background. Keep the design, palette, line quality and rendering identical to the input. No text, no labels, no borders.',
  scene:
    'Make an environment reference sheet of this exact place in this exact style: a 2×2 grid — a wide view, the reverse wide from the far side, a low ground-level view, and a high near-top-down view — completely empty of people or creatures. Keep the architecture, materials, light, palette and rendering identical to the input. No text, no labels, no borders.',
  expression:
    'Make an expression sheet of this exact character in this exact style: a 2×2 grid of tight frontal head-and-shoulders close-ups with identical framing and identical even light — pure joy, peak anger, grief, open laughter. Every identity mark on the face present in every panel. No text, no labels, no borders.'
}

export function SheetGenPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const clip = useStore((s) => (s.selectedClipId ? s.project?.clips.find((c) => c.id === s.selectedClipId) : undefined))
  const selectClip = useStore((s) => s.selectClip)
  const renameClip = useStore((s) => s.renameClip)
  const saveClipPromptData = useStore((s) => s.saveClipPromptData)
  const setKeeper = useStore((s) => s.setKeeper)
  const applyDelta = useStore((s) => s.applyDelta)
  const enqueueRender = useStore((s) => s.enqueueRender)
  const [pickIdx, setPickIdx] = useState(0)
  const [busyTake, setBusyTake] = useState<string | null>(null)
  const [nanoBusy, setNanoBusy] = useState(false)
  const [useNano, setUseNano] = useState(false)
  const ltxSt = useLtxReady()
  // the monitor: what's on it is either a take (video) or a built sheet (image); default = keeper
  const [onScreen, setOnScreen] = useState<{ kind: 'take'; id: string } | { kind: 'sheet'; id: string } | null>(null)
  const [pvH, setPvH] = useState(260)
  const [pvMuted, setPvMuted] = useState(true)
  const [pvPlaying, setPvPlaying] = useState(true)
  const pvRef = useRef<HTMLVideoElement>(null)
  const pvBoxRef = useRef<HTMLDivElement>(null)
  useEffect(() => setOnScreen(null), [clip?.id]) // a different clip → back to its keeper
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

  if (!project) return <EmptyState>open a project to make reference sheets</EmptyState>
  if (!clip || !clip.sheet) {
    // sheet clips FLOAT in the empty panel (the Voice Gen empty state); none yet = teach the entry
    const sheetClips = project.clips.filter((c) => c.sheet)
    return (
      <EmptyState>
        {sheetClips.length > 0 ? (
          <>
            no sheet open — double-click one
            <FloatPick
              items={sheetClips.map((c) => ({ id: c.id, label: c.name, file: project.images.find((i) => i.id === c.sheet!.sourceImageId)?.file, glyph: c.sheet!.mode === 'scene' ? '▭' : '☺' }))}
              onOpen={(id) => selectClip(id)}
              hint="double-click to open it here"
            />
          </>
        ) : (
          <>no sheet open — right-click a Library image → make char plate / scene plate</>
        )}
      </EmptyState>
    )
  }

  const mode = clip.sheet.mode
  const pd = clip.promptData
  const source = project.images.find((i) => i.id === clip.sheet!.sourceImageId)
  const m = modelFor(pd.engine)
  const compiled = compileClip(project, clip)
  const picks = PICKS[mode]
  const pick = picks[Math.min(pickIdx, picks.length - 1)].pick
  const aspect = mode === 'scene' ? '16:9' : '3:4'
  // Clip Gen's MODEL · VIA pair verbatim (lib/engineOptions, bible 12.9): every family, every
  // bridge lane, every installed LTX size — plus the one row Clip Gen lacks, the Nano image lane
  const engine = pd.engine ?? 'seedance2'
  const ltxSize = pd.ltxSize
  const modelRows: DropdownOption[] = [
    ...modelOptions(engine),
    ...(missingPinOption(engine, ltxSize) ? [missingPinOption(engine, ltxSize)!] : []),
    { value: NANO, label: 'Nano Banana (image)' }
  ].map((o) => ({ value: o.value, label: o.label }))
  const viaRows: DropdownOption[] = viaOptions(familyOf(engine) ?? '', engine).map((o) => ({ value: o.value, label: o.label, disabled: o.disabled, title: o.title }))
  const setEnginePick = (patch: { engine?: EngineId; ltxSize?: string | undefined }): void => void saveClipPromptData(clip.id, patch)
  const canRender = !!source && !nanoBusy
  const renderWhy = !source ? 'the source image is gone from the Library' : ''

  // ---- the Seedance lane: a normal 'gen' job from the clip's own compiled fields ----
  const videoJob = (): Parameters<typeof enqueueRender>[0] => {
    const files = (pd.imageIds ?? []).map((id) => project.images.find((i) => i.id === id)?.file).filter((f): f is string => !!f)
    const titles = (pd.imageIds ?? []).map((id) => project.images.find((i) => i.id === id)?.title ?? '')
    const prompt = m.refTagPrompt && files.length ? applyRefTags(compiled.text, titles, m.refTagPrompt) : compiled.text
    return {
      kind: 'gen',
      label: clip.name,
      thumb: source?.file,
      engineLabel: m.label,
      payload: {
        engine: pd.engine,
        mode: 'ref2v',
        prompt,
        freeform: pd.freeform,
        scene: pd.scene,
        characters: pd.characters,
        beats: pd.beats,
        production: pd.production,
        images: files,
        duration: pd.duration,
        resolution: pd.resolution,
        aspectRatio: pd.aspectRatio,
        generateAudio: pd.generateAudio,
        ltxSize: pd.ltxSize,
        clipId: clip.id,
        name: clip.name
      }
    }
  }
  const dispatch = (lane: 'now' | 'queue'): void => {
    if (!canRender) return
    if (useNano) return void runNano()
    if (lane === 'now') useStore.getState().renderNow(videoJob())
    else enqueueRender(videoJob())
  }

  // ---- the Nano lane: image tree → tag to Library → sheet tag (bible 12.8 keys off it) ----
  const runNano = async (): Promise<void> => {
    if (!source || nanoBusy) return
    setNanoBusy(true)
    try {
      const r = await vd().imageGenerate({ rootImageId: source.id, parentNodeId: null, prompt: NANO_PROMPT[mode], refIds: [], numImages: 1, aspectRatio: aspect })
      if (!r.ok || !r.nodeIds?.length) return void toast(r.error ?? 'Nano Banana returned nothing', { kind: 'error' })
      applyDelta(r.delta)
      const session = useStore.getState().project?.editSessions.find((s) => s.rootImageId === source.id)
      if (!session) return void toast('sheet rendered but its image session was not found — open the image tree', { kind: 'error' })
      const tagged = await vd().imageTagNode(session.id, r.nodeIds[0])
      if (!tagged) return void toast('could not tag the sheet into the Library', { kind: 'error' })
      applyDelta(tagged.delta)
      applyDelta(await vd().imageSetSheet(tagged.imageId, mode))
      toast(`${mode} sheet landed in the Library ✓`, { kind: 'ok' })
    } finally {
      setNanoBusy(false)
    }
  }

  // ---- the harvest: one take → five views + the sheet, all Library images ----
  const buildSheet = async (takeId: string): Promise<void> => {
    if (busyTake) return
    setBusyTake(takeId)
    try {
      const r = await vd().sheetBuild(clip.id, takeId, pick)
      if ('error' in r) return void toast(`build sheet failed: ${r.error}`, { kind: 'error' })
      applyDelta(r.delta)
      const title = useStore.getState().project?.images.find((i) => i.id === r.sheetImageId)?.title ?? 'sheet'
      toast(`${title} + ${r.viewImageIds.length} views landed in the Library ✓`, { kind: 'ok' })
    } finally {
      setBusyTake(null)
    }
  }

  const keeperId = clip.keeperTakeId ?? clip.takes[clip.takes.length - 1]?.id
  const sheets = project.images.filter((i) => i.sheetClipId === clip.id)
  // resolve what the monitor shows: an explicit pick, else the keeper take, else the newest sheet
  const shown = (() => {
    if (onScreen?.kind === 'take') {
      const t = clip.takes.find((x) => x.id === onScreen.id)
      if (t) return { kind: 'take' as const, file: t.file, label: `T${clip.takes.indexOf(t) + 1}` }
    }
    if (onScreen?.kind === 'sheet') {
      const s = sheets.find((x) => x.id === onScreen.id)
      if (s) return { kind: 'sheet' as const, file: s.file, label: s.title }
    }
    const k = clip.takes.find((x) => x.id === keeperId)
    if (k) return { kind: 'take' as const, file: k.file, label: `T${clip.takes.indexOf(k) + 1} ★` }
    const s = sheets[sheets.length - 1]
    return s ? { kind: 'sheet' as const, file: s.file, label: s.title } : null
  })()
  const togglePv = (): void => {
    const v = pvRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
        {/* ---- name row: the mode glyph, the clip's name, and the door to the full card ---- */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <span title={`${mode} plate`} style={{ display: 'inline-flex', color: 'var(--gold)' }}>
            {mode === 'scene' ? <Scene size={14} strokeWidth={1.75} /> : <Person size={14} strokeWidth={1.75} />}
          </span>
          <input value={clip.name} onChange={(e) => void renameClip(clip.id, e.target.value)} placeholder="sheet name" style={{ ...ctl, flex: 1 }} />
          <span className="btn vd-hbtn" title="this is an ordinary clip underneath — every field is editable in Clip Gen" onClick={() => openClipEditor()}>
            <Ic i={Pencil} size={11} /> open in Clip Gen
          </span>
        </div>

        {/* ---- MODEL card ---- */}
        {sec('model', 'model', (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb}>model</div>
              <Dropdown
                value={useNano ? NANO : (familyOf(engine) ?? encodeEngine(engine, ltxSize))}
                options={modelRows}
                onChange={(v) => {
                  if (v === NANO) return setUseNano(true)
                  setUseNano(false)
                  // MODEL picks the family; the engine lands on the remembered VIA. Local sizes
                  // stay their own entries ('ltx25|<sizeId>'); an undownloaded local pick fires the wizard
                  if (isFamily(v)) return setEnginePick({ engine: engineForFamily(v), ltxSize: undefined })
                  const dec = decodeEngine(v)
                  setEnginePick({ engine: dec.engine, ltxSize: dec.ltxSize })
                  if (modelFor(dec.engine).provider === 'local' && !ltxSt.renderReady) void modelWizard('ltx-2.5')
                }}
                style={{ minWidth: 150 }}
                title={useNano ? 'Nano Banana repaints — style can drift. Seedance continues the source pixels.' : `the model — every family, every lane, every installed local size (Clip Gen's list)${m.notes ? `\n${m.notes}` : ''}`}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb}>via</div>
              <Dropdown
                value={engine}
                disabled={useNano || viaRows.filter((o) => !o.disabled).length <= 1}
                options={viaRows}
                onChange={(v) => {
                  const id = v as EngineId
                  setEnginePick({ engine: id })
                  const fam = familyOf(id)
                  if (fam) rememberVia(fam, id)
                }}
                style={{ minWidth: 110 }}
                title="who runs this model — each lane bills its own account; your pick is remembered per model"
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb}>mode</div>
              <span style={{ ...ctl, display: 'inline-block', width: 'auto', color: 'var(--txt-hi)' }}>{mode}</span>
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb} title="which four pulled views fill the sheet (TL · TR · BL · BR)">sheet tiles</div>
              <Dropdown value={String(pickIdx)} options={picks.map((p, i) => ({ value: String(i), label: p.label }))} onChange={(v) => setPickIdx(Number(v))} />
            </div>
          </div>
        ))}

        {/* ---- SOURCE + PROMPT card ---- */}
        {sec('source', 'source', (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={lb} title="the image the capture starts from — its pixels continue into every frame">source image</div>
              <div style={{ width: 148, height: 148, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line2)' }}>
                {source ? <img src={mediaUrl(source.file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--dim)', fontSize: 10, textAlign: 'center', padding: 6 }}>source image is gone</span>}
              </div>
              {source && <div style={{ fontSize: 10, color: 'var(--gold)', fontFamily: 'var(--mono)', marginTop: 3 }}>{source.title}</div>}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={lb} title="The Screen Test contract, compiled from this clip's fields — edit any of it in Clip Gen">
                {useNano ? 'nano prompt (injected)' : `prompt as it compiles · ${compiled.parts.total} chars`}
              </div>
              <pre className="vd-copy" style={{ ...ctl, width: '100%', maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 10.5, margin: 0 }}>
                {useNano ? NANO_PROMPT[mode] : compiled.text}
              </pre>
            </div>
          </div>
        ))}

        {/* ---- MONITOR: the take on screen (loop, click = play/pause) or a built sheet — Clip Gen's preview grammar ---- */}
        {shown && sec('preview', 'preview', (
          <div className="field">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--txt-hi)', fontFamily: 'var(--mono)' }}>{shown.label}</span>
              {shown.kind === 'take' && (
                <>
                  <span className="btn vd-hbtn" onClick={togglePv} title="play / pause"><Ic i={pvPlaying ? Pause : Play} size={11} /></span>
                  <span className="btn vd-hbtn" onClick={() => setPvMuted((m) => !m)} title="mute / unmute"><Ic i={pvMuted ? VolumeX : Volume2} size={11} /></span>
                </>
              )}
              {sheets.length > 0 && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 9.5, color: 'var(--dim)' }}>sheets</span>
                  {sheets.map((s) => (
                    <img
                      key={s.id}
                      src={mediaUrl(s.file)}
                      alt=""
                      title={`${s.title} — click to view`}
                      onClick={() => setOnScreen({ kind: 'sheet', id: s.id })}
                      style={{ height: 26, borderRadius: 3, cursor: 'pointer', border: `1px solid ${onScreen?.kind === 'sheet' && onScreen.id === s.id ? 'var(--amber)' : 'var(--line2)'}` }}
                    />
                  ))}
                </span>
              )}
            </div>
            <div ref={pvBoxRef} style={{ height: pvH, background: '#000', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {shown.kind === 'take' ? (
                <video
                  key={shown.file}
                  ref={pvRef}
                  src={mediaUrl(shown.file)}
                  autoPlay
                  loop
                  muted={pvMuted}
                  onClick={togglePv}
                  onPlay={() => setPvPlaying(true)}
                  onPause={() => setPvPlaying(false)}
                  title="click = play / pause"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'pointer' }}
                />
              ) : (
                <img src={mediaUrl(shown.file)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              )}
            </div>
            <ResizeHandle
              value={pvH}
              maxOf={() => {
                const sc = pvBoxRef.current?.closest('.vd-scroll') as HTMLElement | null
                return (sc?.clientHeight ?? 640) - 60
              }}
              onChange={setPvH}
            />
          </div>
        ))}

        {/* ---- TAKES card: every capture is a take; build sheet harvests it ---- */}
        {sec('takes', <span title="click = keeper · ▤ build sheet = pull five views + stack the sheet into the Library">takes</span>, (
          <>
            {clip.takes.length === 0 && <p className="vd-hint">no takes yet — ▶ Generate renders the {mode === 'scene' ? 'five-view survey' : 'five-view capture'}; each render is a take.</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {clip.takes.map((t, i) => (
                <div key={t.id} style={{ width: 150, border: `2px solid ${t.id === keeperId ? 'var(--amber)' : 'var(--line2)'}`, borderRadius: 7, background: 'var(--bg2)', padding: 4 }}>
                  <Thumbnail
                    videoFile={t.file}
                    videoSeek={1.5}
                    scrubVideo={t.file}
                    label={`T${i + 1}${t.id === keeperId ? ' ★' : ''}`}
                    fill
                    w={4}
                    h={mode === 'scene' ? 2.25 : 5.33}
                    active={t.id === keeperId}
                    onClick={() => {
                      // click = keeper AND on the monitor (Clip Gen's take-chip grammar)
                      void setKeeper(clip.id, t.id)
                      setOnScreen({ kind: 'take', id: t.id })
                    }}
                  />
                  <span
                    className="btn vd-hbtn"
                    style={{ display: 'block', textAlign: 'center', marginTop: 4, ...(busyTake ? { opacity: 0.5, cursor: 'default' } : {}) }}
                    title={`pull the five views off this take and stack ${picks[pickIdx]?.label ?? ''} into the sheet`}
                    onClick={() => void buildSheet(t.id)}
                  >
                    {busyTake === t.id ? '⏳ building…' : '▤ build sheet'}
                  </span>
                </div>
              ))}
            </div>
          </>
        ))}
      </div>

      {(!canRender || renderWhy) && renderWhy && <div style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--bad)' }}>✕ {renderWhy}</div>}
      {/* ---- the HERO, pinned (Clip Gen grammar): two-lane render ---- */}
      <div style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
        <span
          className="btn"
          style={{ flex: 1, textAlign: 'center', ...(canRender ? {} : { opacity: 0.5, cursor: 'default' }) }}
          title={useNano ? 'one image through Nano Banana → the Library' : `starts immediately — ${m.label}, 15s ${aspect}`}
          onClick={() => dispatch('now')}
        >
          {nanoBusy ? '⏳ Nano Banana…' : `▶ Generate · ${useNano ? 'Nano Banana' : m.label}`}
        </span>
        {!useNano && (
          <span className="btn" style={{ flex: '0 0 auto', textAlign: 'center', ...(canRender ? {} : { opacity: 0.5, cursor: 'default' }) }} title="add to the render queue — runs in order" onClick={() => dispatch('queue')}>
            ＋ Queue
          </span>
        )}
      </div>
    </div>
  )
}
