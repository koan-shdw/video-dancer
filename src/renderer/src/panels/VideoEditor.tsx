// Video Editor — non-destructive v2v with a persisted results TREE (the video sibling of the
// Image Editor). Right-click a Library video or a take → "edit with AI" opens its session here.
// Every Generate runs FROM the selected node (or the root source) and appends its output as a
// child node. NOTHING reaches the Bin/Library until a node is BAKED (→ clip take / → Library).
// Two composer modes, registry-driven (law 4: parked fields grey with a reason, never vanish):
//   EDIT (Omni Flash /edit) — prompt + source window only; frame-true, ≤10s, 720p out.
//   RE-GEN (Seedance 2 / 2.5) — the source rides as @video1 + the full ref suite (images /
//   extra videos / audio, each windowable) — guided re-generation, not a frame-true edit.
// Layout mirrors Clip Gen: setup (engine · output) at the top, then preview + ONE timeline strip
// (seek + send-window on the same bar), prompt, refs, generate, results tree.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { Thumbnail } from '../Thumbnail'
import { smpte } from '../lib/time'
import { toast } from '../ui/Toast'
import { focusAudio, subAudio } from '../audioBus'
import { MODELS, modelFor } from '../../../shared/models'
import { confirmDialog } from '../prompt'
import { ctl } from '../ui/controls'
import { ContextMenu } from '../ui/ContextMenu'
import { MIME_IMAGE, MIME_VIDEO, MIME_TAKE, MIME_AUDIO } from '../lib/dragDrop'
import { Ic, Film, Star, CircleDot, Trash2, ImagePlay, ListVideo, Music, Wand2, Play, Pause, Volume2, VolumeX } from '../ui/icons'
import type { EngineId } from '../../../shared/types'

// engines the composer offers: the true-edit engine + every engine that takes video refs
const VEDIT_ENGINES = Object.values(MODELS).filter((m) => !m.hidden && (m.v2v || m.maxRefVideos > 0))

// keep the stored value selectable even when the active engine doesn't list it (store-everything)
const withCurrent = (options: string[], current: string): string[] =>
  options.includes(current) ? options : [current, ...options]

interface VTreeRow {
  node: VideoEditNode
  depth: number
}
function vTreeRows(nodes: VideoEditNode[]): VTreeRow[] {
  const byParent = new Map<string | null, VideoEditNode[]>()
  for (const n of nodes) {
    const arr = byParent.get(n.parentId) ?? []
    arr.push(n)
    byParent.set(n.parentId, arr)
  }
  const out: VTreeRow[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function VideoEditorPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const root = useStore((s) => s.editorVideoRoot)
  const applyDelta = useStore((s) => s.applyDelta)

  const [engine, setEngine] = useState<EngineId>('omniflash')
  const [prompt, setPrompt] = useState('')
  const [selNodeId, setSelNodeId] = useState<string | null>(null) // null = the root source
  const [inS, setInS] = useState(0)
  const [outS, setOutS] = useState(0)
  const [srcDur, setSrcDur] = useState(0)
  const [status, setStatus] = useState('idle')
  const [playing, setPlaying] = useState(false)
  const [pvMuted, setPvMuted] = useState(true) // preview muted by default (audio ownership rules)
  // RE-GEN refs (kept across engine switches — store-everything; parked when the engine can't send)
  const [imageRefIds, setImageRefIds] = useState<string[]>([])
  const [extraVideoRefs, setExtraVideoRefs] = useState<VideoRef[]>([])
  const [audioRefs, setAudioRefs] = useState<AudioRef[]>([])
  const [duration, setDuration] = useState('auto')
  const [resolution, setResolution] = useState('720p')
  const [aspect, setAspect] = useState('auto')
  const [genAudio, setGenAudio] = useState(true)
  const [imgPicker, setImgPicker] = useState(false)
  const [vidPicker, setVidPicker] = useState(false)
  const [audPicker, setAudPicker] = useState(false)
  const [dragOver, setDragOver] = useState<'img' | 'vid' | 'aud' | null>(null) // dashed outline on the hovered slot strip
  const [trimSlot, setTrimSlot] = useState<number | null>(null) // ✂ window editor open on this extra-video slot
  const trimInRef = useRef<HTMLInputElement>(null)
  const trimOutRef = useRef<HTMLInputElement>(null)
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string; sub?: 'clip' } | null>(null)
  const vidRef = useRef<HTMLVideoElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const tcRef = useRef<HTMLSpanElement>(null) // live timecode — set imperatively (no per-frame re-render)
  const phRef = useRef<HTMLDivElement>(null) // playhead line — set imperatively (Clip Monitor canon)

  const model = modelFor(engine)
  const isEditMode = !!model.v2v && model.maxRefVideos === 0 // omniflash: true edit, no refs
  const caps = model.v2v

  // ---- resolve the session + source ----
  const sessions = project?.videoEditSessions ?? []
  const session = root
    ? sessions.find((s) =>
        root.videoId ? s.rootVideoId === root.videoId : s.rootTake?.clipId === root.takeRef?.clipId && s.rootTake?.takeId === root.takeRef?.takeId
      )
    : undefined
  const nodes = session?.nodes ?? []
  const rows = vTreeRows(nodes)
  const selNode = selNodeId ? nodes.find((n) => n.id === selNodeId) : undefined
  const rootVideo = root?.videoId ? project?.videos.find((v) => v.id === root.videoId) : undefined
  const rootClip = root?.takeRef ? project?.clips.find((c) => c.id === root.takeRef!.clipId) : undefined
  const rootTake = rootClip?.takes.find((t) => t.id === root?.takeRef?.takeId)
  const rootName = rootVideo?.title ?? (rootClip && rootTake ? `${rootClip.name} · T${rootClip.takes.findIndex((t) => t.id === rootTake.id) + 1}` : undefined)
  // the TRUE original file (a ◉ primary re-faces the Library entry; the root row stays the original)
  const rootFile = session?.originalFile ?? rootVideo?.file ?? rootTake?.file
  const srcFile = selNode?.file ?? rootFile // what the composer edits + the preview shows
  const srcNat = selNode?.durationSec ?? (selNode ? undefined : rootVideo?.durationSec ?? rootTake?.durationSec)

  const libImages = project?.images ?? []
  const libVideos = project?.videos ?? []
  const libAudio = project?.audio ?? []
  // every @mention actually used in the prompt — slots NOT in here get the yellow warn (Clip Gen grammar)
  const mentioned = new Set((prompt.match(/@\w+/g) ?? []).map((s) => s.toLowerCase()))

  // (re)fit the window when the edited source changes
  const srcKey = `${root?.videoId ?? ''}|${root?.takeRef?.clipId ?? ''}|${root?.takeRef?.takeId ?? ''}|${selNodeId ?? 'root'}`
  useEffect(() => {
    const known = srcNat ?? 0
    setSrcDur(known)
    setInS(0)
    setOutS(known > 0 ? Math.min(known, isEditMode ? (caps?.maxInSec ?? 10) : 15) : 0)
    setStatus('idle')
    setPlaying(false)
    paintTime(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  const learnDur = (d: number): void => {
    if (!(d > 0) || srcDur > 0) return
    setSrcDur(d)
    setOutS((o) => (o > 0 ? Math.min(o, d) : Math.min(d, isEditMode ? (caps?.maxInSec ?? 10) : 15)))
  }

  // the window can never exceed the ACTIVE model's max — switching engines snaps it in (the drag
  // clamps below use the same number, so what you can pull always matches the model)
  useEffect(() => {
    const cap = isEditMode ? (caps?.maxInSec ?? 10) : 15
    setOutS((o) => (o - inS > cap ? inS + cap : o))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // ---- transport: play/pause, mute (audio-ownership aware) ----
  useEffect(() => {
    if (vidRef.current) vidRef.current.muted = true
    setPvMuted(true)
  }, [srcFile])
  useEffect(
    () =>
      subAudio(() => {
        if (vidRef.current) setPvMuted(vidRef.current.muted)
      }),
    []
  )
  const togglePlay = (): void => {
    const v = vidRef.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime < inS || v.currentTime > outS - 0.05) v.currentTime = inS
      void v.play()
    } else v.pause()
  }
  const toggleMute = (): void => {
    const v = vidRef.current
    if (!v) return
    if (v.muted) {
      focusAudio(v) // claim audio (mutes the program/source/other previews)
      setPvMuted(false)
    } else {
      v.muted = true
      setPvMuted(true)
    }
  }

  // ---- THE jog bar — the Clip Monitor's canon widget (law 3: one job, one widget) ----
  // Clicking ANYWHERE on the bar scrubs (the window region is pointerEvents:none); trimming is
  // invisible hot-zones on the in/out edges; sliding is the ↔ pill only. Playhead + timecode are
  // set imperatively so playback never re-renders the panel per frame.
  const stripDur = (): number => {
    const v = vidRef.current
    return v && isFinite(v.duration) && v.duration > 0 ? v.duration : srcDur
  }
  const paintTime = (t: number): void => {
    if (tcRef.current) tcRef.current.textContent = smpte(t)
    const dur = stripDur()
    if (phRef.current && dur > 0) phRef.current.style.left = `calc(${Math.min(1, Math.max(0, t / dur)) * 100}% - 1px)`
  }
  const seekTo = (clientX: number): void => {
    const v = vidRef.current
    const bar = stripRef.current
    const dur = stripDur()
    if (!v || !bar || dur <= 0) return
    const r = bar.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    v.currentTime = frac * dur
    paintTime(v.currentTime)
  }
  const onBarDown = (e: React.MouseEvent): void => {
    e.preventDefault() // scrub-drag must never start a native text selection across the panel
    seekTo(e.clientX) // click = move the head
    const move = (ev: MouseEvent): void => seekTo(ev.clientX) // drag = scrub
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const minSpan = isEditMode ? Math.max(0.25, caps?.minInSec ?? 0.25) : 2
  const maxSpan = isEditMode ? (caps?.maxInSec ?? 10) : 15
  const span = Math.max(0, outS - inS)
  const overMax = span > maxSpan + 0.001
  const onEdgeDrag = (kind: 'in' | 'out', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = stripRef.current
    if (!bar || srcDur <= 0) return
    const secPerPx = srcDur / bar.getBoundingClientRect().width
    const startX = e.clientX
    const i0 = inS
    const o0 = outS
    const move = (ev: MouseEvent): void => {
      const d = (ev.clientX - startX) * secPerPx
      if (kind === 'in') setInS(Math.max(Math.max(0, o0 - maxSpan), Math.min(o0 - minSpan, i0 + d)))
      else setOutS(Math.min(Math.min(srcDur, i0 + maxSpan), Math.max(i0 + minSpan, o0 + d)))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // slide the whole window — its OWN lane, so it never fights the jog ruler (Premiere grammar)
  const onWindowDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = stripRef.current
    if (!bar || srcDur <= 0) return
    const secPerPx = srcDur / bar.getBoundingClientRect().width
    const startX = e.clientX
    const i0 = inS
    const o0 = outS
    const move = (ev: MouseEvent): void => {
      const d = (ev.clientX - startX) * secPerPx
      const w = o0 - i0
      const ni = Math.max(0, Math.min(srcDur - w, i0 + d))
      setInS(ni)
      setOutS(ni + w)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // completion watcher: a finished vedit job for THIS session selects its fresh node
  const queue = useStore((s) => s.queue)
  useEffect(() => {
    const job = queue.find((j) => j.kind === 'vedit' && j.status === 'done' && !j.consumed)
    if (!job) return
    useStore.getState().consumeJob(job.id)
    const p = job.payload as VeditArgs
    const sameRoot = root && (root.videoId ? p.root.videoId === root.videoId : p.root.takeRef?.clipId === root.takeRef?.clipId && p.root.takeRef?.takeId === root.takeRef?.takeId)
    if (sameRoot && job.resultNodeId) {
      setSelNodeId(job.resultNodeId)
      setStatus('done ✓ — new node added to the tree')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  // ---- cost estimate ----
  const durNum = duration === 'auto' ? Math.max(4, Math.round(span || 5)) : parseFloat(duration) || 5
  const est = isEditMode && caps ? span * (caps.pricePerSecIn + caps.pricePerSecOut) : (model.pricePerSec[resolution] ?? 0) * durNum

  // ---- validations (each would be a paid 422 otherwise) ----
  const vrefSecOf = (r: VideoRef): number | undefined => {
    if (r.inSec != null && r.outSec != null && r.outSec > r.inSec) return r.outSec - r.inSec
    if (r.videoId) return libVideos.find((v) => v.id === r.videoId)?.durationSec
    const c = project?.clips.find((x) => x.id === r.takeRef?.clipId)
    return c?.takes.find((t) => t.id === r.takeRef?.takeId)?.durationSec
  }
  const vrefNameOf = (r: VideoRef): { name: string; file?: string; natSec?: number } => {
    if (r.videoId) {
      const v = libVideos.find((x) => x.id === r.videoId)
      return { name: v?.title ?? '(deleted video)', file: v?.file, natSec: v?.durationSec }
    }
    const c = project?.clips.find((x) => x.id === r.takeRef?.clipId)
    const t = c?.takes.find((x) => x.id === r.takeRef?.takeId)
    const tn = c && t ? c.takes.findIndex((x) => x.id === t.id) + 1 : 0
    return { name: c && t ? `${c.name} · T${tn}` : '(deleted take)', file: t?.file, natSec: t?.durationSec }
  }
  const extraVSecs = extraVideoRefs.map(vrefSecOf)
  const audioSecs = audioRefs.map((r) =>
    r.inSec != null && r.outSec != null && r.outSec > r.inSec ? r.outSec - r.inSec : libAudio.find((a) => a.id === r.audioId)?.durationSec
  )
  const problems: string[] = []
  if (!isEditMode) {
    if (1 + extraVideoRefs.length > model.maxRefVideos) problems.push(`too many videos — the source is @video1, so at most ${model.maxRefVideos - 1} extra`)
    if (imageRefIds.length > model.maxRefImages) problems.push(`too many image refs (${imageRefIds.length}/${model.maxRefImages})`)
    if (audioRefs.length > model.maxRefAudios) problems.push(`too many audio refs (${audioRefs.length}/${model.maxRefAudios})`)
    const totalV = span + extraVSecs.reduce((s: number, x) => s + (x ?? 0), 0)
    if (!extraVSecs.some((x) => x == null) && totalV > 15.05) problems.push(`videos are ${totalV.toFixed(1)}s combined — fal caps 15s (shrink the window / trim extras)`)
    const totalA = audioSecs.reduce((s: number, x) => s + (x ?? 0), 0)
    if (!audioSecs.some((x) => x == null) && totalA > 15.05) problems.push(`audio refs are ${totalA.toFixed(1)}s combined — fal caps 15s`)
    if (1 + extraVideoRefs.length + imageRefIds.length + audioRefs.length > 12) problems.push('over 12 reference files total (fal cap)')
  } else if (overMax) problems.push(`window is ${span.toFixed(1)}s — ${model.label} accepts at most ${maxSpan}s`)

  const run = (): void => {
    if (!root || !srcFile) return
    if (!prompt.trim()) return void toast('write the instruction first', { kind: 'error' })
    if (problems.length) return void toast(problems[0], { kind: 'error' })
    const sendWindow = srcDur > 0 ? inS > 0.01 || outS < srcDur - 0.01 : outS > inS
    useStore.getState().enqueueRender({
      kind: 'vedit',
      label: `${rootName ?? 'video'} · ${isEditMode ? 'edit' : 're-gen'}`,
      thumbVideo: srcFile,
      thumbSeek: inS,
      engineLabel: model.label,
      estCost: est > 0 ? est : undefined,
      payload: {
        engine,
        prompt: prompt.trim(),
        root,
        parentId: selNodeId,
        ...(sendWindow ? { inSec: inS, outSec: outS } : {}),
        ...(isEditMode
          ? {}
          : {
              imageRefIds: imageRefIds.length ? imageRefIds : undefined,
              videoRefs: extraVideoRefs.length ? extraVideoRefs : undefined,
              audioRefs: audioRefs.length ? audioRefs : undefined,
              duration,
              resolution,
              aspectRatio: aspect,
              generateAudio: genAudio
            })
      } as VeditArgs
    })
    setStatus('queued → watch the Queue panel')
  }

  // ---- bakes + node actions ----
  const bakeLibrary = async (nodeId: string): Promise<void> => {
    if (!session) return
    const r = await window.vidancer.veditBakeLibrary(session.id, nodeId)
    if (!r) return void toast('bake failed', { kind: 'error' })
    applyDelta(r.delta)
    toast('baked → Library videos ✓ (usable as an @video ref)', { kind: 'ok' })
  }
  const bakeClip = async (nodeId: string, clipId?: string): Promise<void> => {
    if (!session) return
    const r = await window.vidancer.veditBakeClip(session.id, nodeId, clipId ? { clipId } : {})
    if (!r) return void toast('bake failed', { kind: 'error' })
    applyDelta(r.delta)
    useStore.getState().selectClip(r.clipId)
    toast(clipId ? 'baked → new take on the clip ✓' : 'baked → new clip in the Bin ✓', { kind: 'ok' })
  }
  const setPrimary = async (nodeId: string | null): Promise<void> => {
    if (!session) return
    const d = await window.vidancer.veditSetPrimary(session.id, nodeId)
    if (!d) return void toast('only Library-video sources can take a ◉ primary (takes are immutable)', { kind: 'error' })
    applyDelta(d)
    toast(nodeId ? '◉ primary set — every @video ref using this Library video follows' : 'reverted to the original', { kind: 'ok' })
  }
  const deleteBranch = async (nodeId: string): Promise<void> => {
    if (!session) return
    const kids = nodes.filter((x) => x.parentId === nodeId).length
    if (!(await confirmDialog(`Delete this node${kids ? ' and its whole branch' : ''}? Renders are removed from disk (baked copies survive). (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true }))) return
    const d = await window.vidancer.veditDeleteBranch(session.id, nodeId)
    if (!d) return void toast("can't delete — the ◉ primary lives in this branch (revert it first)", { kind: 'error' })
    applyDelta(d)
    if (selNodeId === nodeId) setSelNodeId(null)
  }

  if (!root || !srcFile) {
    return (
      <div className="vd-panel vd-scroll" style={{ padding: 14, color: 'var(--dim)', fontSize: 12, lineHeight: 1.6 }}>
        <b style={{ color: 'var(--muted)' }}>Video Editor — non-destructive v2v tree</b>
        <br />
        Right-click a Library video or a take → <b>edit with AI</b> (double-click a Library video works too).
        Every generation lands as a node you can branch, compare, and bake — the source is never touched.
        <br />
        Bake any node: → take on a clip · → new clip · → Library videos (then it works as an @video ref).
      </div>
    )
  }

  const winL = srcDur > 0 ? (inS / srcDur) * 100 : 0
  const winW = srcDur > 0 ? (span / srcDur) * 100 : 100
  const pvDur = stripDur()

  return (
    <div className="vd-panel vd-scroll" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
      {/* source line */}
      <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Ic i={Film} size={12} />
        source: <b style={{ color: 'var(--txt-hi)' }}>{rootName ?? '(deleted source)'}</b>
        {rootClip && (
          <span className="btn vd-hbtn" onClick={() => useStore.getState().selectClip(rootClip.id)} title="select the source clip in the Bin">
            go to source
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', color: 'var(--dim)' }}>
          {selNode ? `node · ${selNode.durationSec ? smpte(selNode.durationSec) : '…'}` : `original · ${srcDur > 0 ? smpte(srcDur) : '…'}`}
        </span>
      </div>

      {/* setup — engine · output (top, exactly like Clip Gen's setup section) */}
      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div className="lb">engine</div>
          <select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} style={ctl} title="edit engine — switching keeps ALL inputs; unsupported ones grey out">
            {VEDIT_ENGINES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.v2v && m.maxRefVideos === 0 ? `${m.label} — true edit` : `${m.label} — re-gen with refs`}
              </option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: 9, color: 'var(--dim)', paddingBottom: 4 }}>
          {isEditMode ? 'frame-true edit · prompt only · output 720p 16:9 · window ≤10s' : `guided re-generation · source = @video1 · full ref suite${model.notes ? ` · ${model.notes}` : ''}`}
        </div>
      </div>
      <div className="field" style={{ display: 'flex', gap: 8, ...(isEditMode ? { opacity: 0.55 } : {}) }} title={isEditMode ? `${model.label} controls its own output (720p 16:9, length = the window) — these apply to re-gen engines` : undefined}>
        <div style={{ flex: 1 }}>
          <div className="lb">duration</div>
          <select value={duration} disabled={isEditMode} onChange={(e) => setDuration(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.durations, duration).map((d) => (<option key={d}>{d}</option>))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div className="lb">resolution</div>
          <select value={resolution} disabled={isEditMode} onChange={(e) => setResolution(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.resolutions, resolution).map((r) => (<option key={r}>{r}</option>))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div className="lb">aspect</div>
          <select value={aspect} disabled={isEditMode} onChange={(e) => setAspect(e.target.value)} style={{ ...ctl, width: '100%' }}>
            {withCurrent(model.aspectRatios, aspect).map((a) => (<option key={a}>{a}</option>))}
          </select>
        </div>
        <div style={{ flex: '0 0 auto', alignSelf: 'flex-end', paddingBottom: 5 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: isEditMode ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={isEditMode ? true : genAudio} disabled={isEditMode} onChange={(e) => setGenAudio(e.target.checked)} />
            <span className="lb" style={{ margin: 0 }}>{isEditMode ? 'audio: always on' : 'generate audio'}</span>
          </label>
        </div>
      </div>

      {/* preview + THE timeline strip (seek + send-window on one bar) */}
      <div style={{ position: 'relative', background: '#000', borderRadius: 6, overflow: 'hidden', minHeight: 120, maxHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <video
          ref={vidRef}
          key={srcFile}
          src={mediaUrl(srcFile)}
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => learnDur(e.currentTarget.duration)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            paintTime(v.currentTime)
            // playback loops inside the send-window — that's exactly what the model receives
            if (!v.paused && srcDur > 0 && v.currentTime > outS - 0.03) v.currentTime = inS
          }}
          style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain', display: 'block', cursor: 'pointer' }}
        />
        <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4, pointerEvents: 'none' }}>
          {selNode ? 'node — Generate runs FROM this' : 'original'}
          {!playing ? ' · click to play' : ''}
        </span>
      </div>
      <div className="field">
        {/* transport row: play/mute + the send-window facts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 10, color: 'var(--dim)' }}>
          <span className="btn vd-hbtn" onClick={togglePlay} title="play / pause (loops inside the window) — clicking the video works too"><Ic i={playing ? Pause : Play} size={11} /></span>
          <span className="btn vd-hbtn" onClick={toggleMute} title="mute / unmute (unmuting claims audio from other players)"><Ic i={pvMuted ? VolumeX : Volume2} size={11} /></span>
          <span>
            window {span.toFixed(1)}s{srcDur > maxSpan ? ` of ${srcDur.toFixed(1)}s` : ''}
            {!isEditMode && ' — sent as @video1'}
          </span>
          {overMax && <span style={{ color: 'var(--bad)' }}>max {maxSpan}s</span>}
          <span style={{ marginLeft: 'auto' }}>bar scrubs · edges trim · ↔ slides</span>
        </div>
        {/* live timecode — current set imperatively, total derived (Clip Monitor canon) */}
        <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--txt-hi)', letterSpacing: 0.5, marginBottom: 4 }}>
          <span ref={tcRef}>{smpte(0)}</span>
          <span style={{ color: 'var(--dim)', fontSize: 11 }}> / {pvDur > 0 ? smpte(pvDur) : '…'}</span>
        </div>
        {/* THE jog bar — the Clip Monitor's widget: seek wins everywhere, trim = edge hot-zones,
            slide = the ↔ pill only */}
        <div
          ref={stripRef}
          onMouseDown={onBarDown}
          title="click / drag to scrub the source"
          style={{ position: 'relative', height: 22, background: 'var(--raised2)', borderRadius: 4, cursor: 'pointer', overflow: 'hidden', userSelect: 'none' }}
        >
          {/* in/out region: NON-interactive (pointerEvents none) so a click anywhere here still scrubs */}
          <div
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${winL}%`, width: `${winW}%`, background: overMax ? 'color-mix(in srgb, var(--bad) 22%, transparent)' : 'color-mix(in srgb, var(--amber) 22%, transparent)', borderLeft: `2px solid ${overMax ? 'var(--bad)' : 'var(--amber)'}`, borderRight: `2px solid ${overMax ? 'var(--bad)' : 'var(--amber)'}`, pointerEvents: 'none', zIndex: 2 }}
          />
          <div onMouseDown={(e) => onEdgeDrag('in', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `${winL}%`, width: 10, marginLeft: -5, cursor: 'ew-resize', zIndex: 3 }} title={`in ${inS.toFixed(2)}s — drag to trim`} />
          <div onMouseDown={(e) => onEdgeDrag('out', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `${winL + winW}%`, width: 10, marginLeft: -5, cursor: 'ew-resize', zIndex: 3 }} title={`out ${outS.toFixed(2)}s — drag to trim`} />
          {/* grab handle in the MIDDLE of the region — only THIS slides the window; everywhere else seeks */}
          <div
            onMouseDown={onWindowDown}
            title="grab to slide the in/out window"
            style={{ position: 'absolute', left: `${winL + winW / 2}%`, top: '50%', transform: 'translate(-50%, -50%)', height: 16, minWidth: 22, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', zIndex: 4, color: 'var(--raised)', background: overMax ? 'var(--bad)' : 'var(--amber)', borderRadius: 8, fontSize: 11, fontWeight: 700, lineHeight: 1, userSelect: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,.35)' }}
          >
            ↔
          </div>
          <div ref={phRef} style={{ position: 'absolute', top: 0, bottom: 0, left: '0%', width: 2, background: '#fff', pointerEvents: 'none', zIndex: 5 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 3 }}>
          <span>in {inS.toFixed(2)}s</span>
          <span style={{ color: 'var(--muted)' }}>{selNode ? 'node' : 'original'}{rootName ? ` · ${rootName}` : ''}</span>
          <span>out {outS.toFixed(2)}s</span>
        </div>
      </div>

      {/* prompt */}
      <div className="field">
        <div className="lb">{isEditMode ? 'edit instruction' : 're-gen prompt'} <span style={{ color: 'var(--dim)' }}>— @mention the refs to bind them</span></div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={isEditMode ? 'Make it nighttime. Keep everything else the same.' : 'Restyle @video1 to match @image1. Keep the exact motion and timing.'}
          rows={3}
          style={{ ...ctl, width: '100%', resize: 'vertical' }}
        />
        {isEditMode && caps && <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{caps.promptHint}</div>}
      </div>

      {/* re-gen ref suite — Clip Gen slot grammar (drag in / + add / yellow = not @mentioned).
          Parked (visible, greyed, not sent) while the engine is Omni (law 4). */}
      {(!isEditMode || imageRefIds.length > 0 || extraVideoRefs.length > 0 || audioRefs.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...(isEditMode ? { opacity: 0.55 } : {}) }} title={isEditMode ? `${model.label} takes no refs — these are kept but will NOT be sent` : undefined}>
          {/* image refs */}
          <div className="field">
            <div className="lb">
              image refs (@refs, ≤{isEditMode ? '—' : model.maxRefImages}) <span style={{ color: 'var(--dim)' }}>— drag Library images in · yellow = not @mentioned</span>
            </div>
            <div
              onDragOver={(e) => {
                if (isEditMode) return
                if (Array.from(e.dataTransfer.types).includes(MIME_IMAGE)) {
                  e.preventDefault()
                  setDragOver('img')
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                setDragOver(null)
                if (isEditMode) return
                const f = e.dataTransfer.getData(MIME_IMAGE)
                if (!f) return
                e.preventDefault()
                const hit = libImages.find((i) => i.file === f)
                if (hit && !imageRefIds.includes(hit.id)) setImageRefIds((a) => [...a, hit.id])
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, outline: dragOver === 'img' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
            >
              {imageRefIds.map((id) => {
                const im = libImages.find((i) => i.id === id)
                return (
                  <Thumbnail
                    key={id}
                    file={im?.file}
                    label={im ? `${im.title} — mention it in the prompt to bind it` : '(deleted image)'}
                    w={64}
                    h={40}
                    warn={!!im && !mentioned.has(im.title.toLowerCase())}
                    onClear={() => setImageRefIds((a) => a.filter((x) => x !== id))}
                  />
                )
              })}
              {!isEditMode && imageRefIds.length < model.maxRefImages && (
                <span style={{ position: 'relative' }}>
                  <span className="vd-slot" onClick={() => setImgPicker((v) => !v)} title="add an image reference — pick a Library image (or drag one in)">+ add</span>
                  {imgPicker && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 230, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                      {libImages.filter((i) => !imageRefIds.includes(i.id)).map((i) => (
                        <div key={i.id} onMouseDown={(e) => { e.preventDefault(); setImageRefIds((a) => [...a, i.id]); setImgPicker(false) }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}>
                          <img src={mediaUrl(i.file)} alt="" style={{ width: 34, height: 22, objectFit: 'cover', borderRadius: 2, flex: '0 0 auto' }} />
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.title}</span>
                        </div>
                      ))}
                      {libImages.length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no Library images yet</div>}
                    </div>
                  )}
                </span>
              )}
            </div>
          </div>
          {/* extra video refs */}
          <div className="field">
            <div className="lb">
              extra video refs (@video2…, ≤{isEditMode ? '—' : Math.max(0, model.maxRefVideos - 1)}) <span style={{ color: 'var(--dim)' }}>— drag Library videos or T-chips in · yellow = not @mentioned</span>
            </div>
            <div
              onDragOver={(e) => {
                if (isEditMode) return
                const t = Array.from(e.dataTransfer.types)
                if (t.includes(MIME_VIDEO) || t.includes(MIME_TAKE)) {
                  e.preventDefault()
                  setDragOver('vid')
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                setDragOver(null)
                if (isEditMode) return
                const vid = e.dataTransfer.getData(MIME_VIDEO)
                if (vid) {
                  e.preventDefault()
                  setExtraVideoRefs((a) => [...a, { videoId: vid }])
                  return
                }
                const tk = e.dataTransfer.getData(MIME_TAKE)
                if (tk) {
                  e.preventDefault()
                  try {
                    const o = JSON.parse(tk) as { clipId?: string; takeId?: string }
                    if (o.clipId && o.takeId) setExtraVideoRefs((a) => [...a, { takeRef: { clipId: o.clipId!, takeId: o.takeId! } }])
                  } catch { /* malformed drag payload — ignore */ }
                }
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', padding: 4, borderRadius: 6, outline: dragOver === 'vid' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
            >
              {extraVideoRefs.map((r, i) => {
                const info = vrefNameOf(r)
                const sec = vrefSecOf(r)
                const tag = `@video${i + 2}`
                const windowed = r.inSec != null && r.outSec != null
                const trimOpen = trimSlot === i
                return (
                  <div key={i} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                    <Thumbnail
                      videoFile={info.file}
                      videoSeek={r.inSec}
                      scrubVideo={info.file}
                      label={`${tag} = ${info.name}${sec != null ? ` · sends ${sec.toFixed(1)}s` : ''} — mention ${tag} in the prompt to bind it`}
                      w={64}
                      h={40}
                      warn={!mentioned.has(tag)}
                      onClear={() => {
                        setExtraVideoRefs((a) => a.filter((_, j) => j !== i))
                        setTrimSlot(null)
                      }}
                    />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: info.file ? 'var(--gold)' : 'var(--bad)', maxWidth: 70, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag}</span>
                    <span
                      className="btn vd-hbtn"
                      style={{ fontSize: 9, ...(windowed ? { color: 'var(--amber)' } : {}) }}
                      title={windowed ? `sends ${r.inSec!.toFixed(1)}–${r.outSec!.toFixed(1)}s of the source — click to change` : 'send only a window of this video (fal caps refs at 15s combined)'}
                      onClick={() => setTrimSlot(trimOpen ? null : i)}
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
                              if (b - a > 15) b = a + 15 // fal's video-ref cap — the popover can't exceed it either
                              setExtraVideoRefs((arr) => arr.map((x, j) => (j === i ? { ...x, inSec: Math.max(0, a), outSec: b } : x)))
                            }
                            setTrimSlot(null)
                          }}
                        >
                          set
                        </span>
                        <span className="btn vd-hbtn" title="send the whole video" onClick={() => { setExtraVideoRefs((arr) => arr.map((x, j) => (j === i ? { ...x, inSec: undefined, outSec: undefined } : x))); setTrimSlot(null) }}>full</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {!isEditMode && 1 + extraVideoRefs.length < model.maxRefVideos && (
                <span style={{ position: 'relative' }}>
                  <span className="vd-slot" onClick={() => setVidPicker((v) => !v)} title="add a video reference — pick a Library video or a keeper take (or drag either in; drag a specific T-chip for another take)">+ add</span>
                  {vidPicker && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 230, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                      {libVideos.map((v) => (
                        <div key={v.id} onMouseDown={(e) => { e.preventDefault(); setExtraVideoRefs((a) => [...a, { videoId: v.id }]); setVidPicker(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                          <Ic i={Film} size={11} /> {v.title}{v.durationSec ? ` · ${v.durationSec.toFixed(1)}s` : ''}
                        </div>
                      ))}
                      {(project?.clips ?? []).filter((c) => c.takes.length > 0).map((c) => {
                        const t = c.takes.find((x) => x.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
                        return (
                          <div key={c.id} onMouseDown={(e) => { e.preventDefault(); setExtraVideoRefs((a) => [...a, { takeRef: { clipId: c.id, takeId: t.id } }]); setVidPicker(false) }} title="the clip's keeper take — drag a specific T-chip from its takes row for another" style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
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
          {/* audio refs */}
          <div className="field">
            <div className="lb">
              audio refs (@audio1…, ≤{isEditMode ? '—' : model.maxRefAudios} · ≤15s combined) <span style={{ color: 'var(--dim)' }}>— drag Library music in · needs ≥1 visual ref</span>
            </div>
            <div
              onDragOver={(e) => {
                if (isEditMode) return
                if (Array.from(e.dataTransfer.types).includes(MIME_AUDIO)) {
                  e.preventDefault()
                  setDragOver('aud')
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                setDragOver(null)
                if (isEditMode) return
                const id = e.dataTransfer.getData(MIME_AUDIO)
                if (!id) return
                e.preventDefault()
                setAudioRefs((a) => [...a, { audioId: id }])
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, outline: dragOver === 'aud' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
            >
              {audioRefs.map((r, i) => {
                const a = libAudio.find((x) => x.id === r.audioId)
                const sec = audioSecs[i]
                const tag = `@audio${i + 1}`
                const windowed = r.inSec != null && r.outSec != null
                const tooLong = !windowed && sec != null && sec > 15
                return (
                  <span
                    key={i}
                    title={`${tag} = ${a?.title ?? '(deleted track)'}${sec != null ? ` · sends ${sec.toFixed(1)}s` : ''} — mention ${tag} in the prompt to bind it`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 7px', borderRadius: 5, border: '1px solid', borderColor: !mentioned.has(tag) ? 'var(--amber)' : 'var(--line2)', background: 'var(--raised2)', fontSize: 10.5 }}
                  >
                    <span style={{ color: a ? 'var(--amber)' : 'var(--bad)' }}><Ic i={Music} size={10} /></span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>{tag}</span>
                    <span style={{ maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: a ? 'var(--body)' : 'var(--bad)' }}>{a?.title ?? '(deleted track)'}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: tooLong ? 'var(--bad)' : 'var(--dim)', fontSize: 9.5 }} title={tooLong ? `whole track is ${sec!.toFixed(0)}s — set a ≤15s window or the render is blocked` : undefined}>
                      {sec != null ? `${sec.toFixed(1)}s` : '…'}
                    </span>
                    <input
                      type="number" min={0} step={0.1} value={r.inSec ?? ''} placeholder="in"
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        setAudioRefs((arr) => arr.map((x, j) => {
                          if (j !== i) return x
                          const ni = Number.isNaN(v) ? undefined : Math.max(0, v)
                          // the window can never exceed fal's 15s audio cap — moving IN drags OUT along
                          const no = ni != null && x.outSec != null && x.outSec - ni > 15 ? ni + 15 : x.outSec
                          return { ...x, inSec: ni, outSec: no }
                        }))
                      }}
                      style={{ ...ctl, width: 44, padding: '1px 4px', fontSize: 10 }} title="window start (seconds into the track)"
                    />
                    <input
                      type="number" min={0} step={0.1} value={r.outSec ?? ''} placeholder="out"
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        setAudioRefs((arr) => arr.map((x, j) => {
                          if (j !== i) return x
                          if (Number.isNaN(v)) return { ...x, outSec: undefined }
                          const base = x.inSec ?? 0
                          return { ...x, outSec: v - base > 15 ? base + 15 : v } // fal caps audio refs at 15s
                        }))
                      }}
                      style={{ ...ctl, width: 44, padding: '1px 4px', fontSize: 10 }} title="window end (seconds into the track) — capped at 15s span"
                    />
                    <span style={{ cursor: 'pointer', color: 'var(--dim)', padding: '0 2px' }} title="remove" onClick={() => setAudioRefs((a2) => a2.filter((_, j) => j !== i))}>✕</span>
                  </span>
                )
              })}
              {!isEditMode && audioRefs.length < model.maxRefAudios && (
                <span style={{ position: 'relative' }}>
                  <span className="vd-slot" onClick={() => setAudPicker((v) => !v)} title="add an audio reference — pick a Library music track (or drag one in)">+ add</span>
                  {audPicker && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 200, maxHeight: 200, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                      {libAudio.map((a) => (
                        <div key={a.id} onMouseDown={(e) => { e.preventDefault(); setAudioRefs((x) => [...x, { audioId: a.id }]); setAudPicker(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                          <Ic i={Music} size={11} /> {a.title}{a.durationSec ? ` · ${a.durationSec.toFixed(0)}s` : ''}
                        </div>
                      ))}
                      {libAudio.length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no Library music yet — import it in the Library panel</div>}
                    </div>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* generate bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="btn" onClick={run}>▶ Generate {isEditMode ? 'edit' : 're-gen'} {selNode ? 'from this node' : 'from the original'}</span>
        {est > 0 && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }} title={isEditMode ? 'output + input video tokens' : 'estimated fal cost'}>~${est.toFixed(2)}{duration === 'auto' && !isEditMode ? '*' : ''}</span>}
        <span style={{ fontSize: 11, color: status.startsWith('✕') ? 'var(--bad)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status}</span>
      </div>
      {problems.length > 0 && (
        <div className="field" style={{ fontSize: 10 }}>
          {problems.map((p, i) => <div key={i} style={{ color: 'var(--bad)' }}>✕ {p}</div>)}
        </div>
      )}

      {/* the TREE — root row + generated nodes, indented under their parent */}
      <div className="field" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
        <div className="lb" style={{ marginBottom: 4 }}>
          results tree <span style={{ color: 'var(--dim)' }}>— click = select & view (Generate runs FROM the selection) · right-click = actions</span>
        </div>
        <div
          onClick={() => setSelNodeId(null)}
          title="the untouched source — click to select it (Generate runs from here)"
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 6px', borderRadius: 5, cursor: 'pointer', border: '1px solid', borderColor: selNodeId === null ? 'var(--amber)' : 'transparent', marginBottom: 2 }}
        >
          {rootFile && <Thumbnail videoFile={rootFile} scrubVideo={rootFile} w={52} h={33} />}
          <span style={{ fontSize: 11, color: 'var(--txt-hi)' }}>original</span>
          {session?.primaryNodeId && <span style={{ fontSize: 9, color: 'var(--dim)' }}>(the Library entry wears a ◉ node — this row stays the true original)</span>}
        </div>
        {rows.map(({ node, depth }) => {
          const isSel = node.id === selNodeId
          const isPrimary = session?.primaryNodeId === node.id
          return (
            <div
              key={node.id}
              onClick={() => setSelNodeId(node.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setNodeMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
              }}
              title={`${node.prompt}\n${modelFor(node.engine).label}${node.refSummary ? ' · ' + node.refSummary : ''}${node.inSec != null && node.outSec != null ? ` · window ${node.inSec.toFixed(1)}–${node.outSec.toFixed(1)}s` : ''}\nclick = select & view · right-click = bake / ◉ / delete`}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 6px', marginLeft: 14 + depth * 18, borderRadius: 5, cursor: 'pointer', border: '1px solid', borderColor: isSel ? 'var(--amber)' : 'var(--line)', marginBottom: 2, background: 'var(--panel)' }}
            >
              <Thumbnail videoFile={node.file} scrubVideo={node.file} w={52} h={33} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.prompt || '(no prompt)'}
              </span>
              <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', flex: '0 0 auto' }}>
                {modelFor(node.engine).label.replace('Gemini ', '')}{node.durationSec ? ` · ${node.durationSec.toFixed(1)}s` : ''}
              </span>
              {isPrimary && <span title="◉ primary — the Library video currently wears this render"><Ic i={CircleDot} size={11} /></span>}
              {node.keptVideoId && <span title="baked to Library videos"><Ic i={Star} size={11} /></span>}
            </div>
          )
        })}
        {rows.length === 0 && <div style={{ fontSize: 10.5, color: 'var(--dim)', marginLeft: 14 }}>no generations yet — write an instruction and hit Generate</div>}
      </div>

      {/* node right-click menu — the app-wide ContextMenu; the ▸ entry re-opens with the clip list */}
      {nodeMenu && session && (
        <ContextMenu
          x={nodeMenu.x}
          y={nodeMenu.y}
          entries={
            nodeMenu.sub === 'clip'
              ? (project?.clips ?? []).length
                ? (project?.clips ?? []).map((c) => ({
                    label: <>▶ {c.name}</>,
                    onClick: () => void bakeClip(nodeMenu.nodeId, c.id)
                  }))
                : [{ label: <span style={{ color: 'var(--dim)' }}>no clips yet</span> }]
              : [
                  { label: <><Ic i={ImagePlay} size={12} /> bake → NEW clip (take 1)</>, onClick: () => void bakeClip(nodeMenu.nodeId) },
                  {
                    // ContextMenu closes itself after any entry click — re-open as the clip list a tick
                    // later with the SAME coordinates (captured; the state is already null by then)
                    label: <><Ic i={ListVideo} size={12} /> bake → take on existing clip ▸</>,
                    onClick: () => {
                      const { x, y, nodeId } = nodeMenu
                      setTimeout(() => setNodeMenu({ x, y, nodeId, sub: 'clip' }), 0)
                    }
                  },
                  { label: <><Ic i={Film} size={12} /> bake → Library videos</>, onClick: () => void bakeLibrary(nodeMenu.nodeId) },
                  ...(session.rootVideoId
                    ? [
                        {
                          label: <><Ic i={CircleDot} size={12} /> {session.primaryNodeId === nodeMenu.nodeId ? 'revert Library entry to original' : '◉ make primary (re-face the Library video)'}</>,
                          onClick: () => void setPrimary(session.primaryNodeId === nodeMenu.nodeId ? null : nodeMenu.nodeId)
                        }
                      ]
                    : []),
                  { label: '', sep: true },
                  { label: <><Ic i={Wand2} size={12} /> select — next Generate branches from here</>, onClick: () => setSelNodeId(nodeMenu.nodeId) },
                  { label: <><Ic i={Trash2} size={12} /> delete branch</>, danger: true, onClick: () => void deleteBranch(nodeMenu.nodeId) }
                ]
          }
          onClose={() => setNodeMenu(null)}
        />
      )}
    </div>
  )
}
