import { vd } from '../api'
import { EmptyState } from '../ui/EmptyState'
// Video Editor — non-destructive v2v with a persisted results TREE (the video sibling of the
// Image Editor). Right-click a Library video or a take → "⑂ edit v2v" opens its session here.
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
import { MODELS, modelFor, withCurrent } from '../shared/models'
import { confirmDialog } from '../prompt'
import { ctl } from '../ui/controls'
import { ContextMenu, Dropdown, aspectLabel } from '@koan/shared'
import { JogBar, type JogBarHandle } from '../ui/JogBar'
import { ResizeHandle } from '../ui/ResizeHandle'
import { RefSuite, vrefSecOf } from '../ui/RefSuite'
import { MIME_VEDITNODE } from '../lib/dragDrop'
import { Ic, Film, Star, CircleDot, Trash2, ImagePlay, ListVideo, Wand2 } from '../ui/icons'
import type { EngineId } from '../shared/types'

// engines the composer offers: the true-edit engine + every engine that takes video refs
const VEDIT_ENGINES = Object.values(MODELS).filter((m) => !m.hidden && (m.v2v || m.maxRefVideos > 0))

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
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string; sub?: 'clip' } | null>(null)
  const vidRef = useRef<HTMLVideoElement>(null)
  const jogRef = useRef<JogBarHandle>(null)
  const pvBoxRef = useRef<HTMLDivElement>(null)
  const previewH = useStore((s) => s.previewH.clipEdit)
  const setPreviewH = useStore((s) => s.setPreviewH) // imperative playhead/timecode painter (Clip Monitor canon)

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

  const libAudio = project?.audio ?? []

  // (re)fit the window when the edited source changes — ⑂ hands the block's trims in via the
  // root, so the send window opens exactly on the cut being fixed (root source only; trims are
  // part of the key: ⑂ on the same take with different trims must reload)
  const srcKey = `${root?.videoId ?? ''}|${root?.takeRef?.clipId ?? ''}|${root?.takeRef?.takeId ?? ''}|${root?.inSec ?? ''}|${root?.outSec ?? ''}|${selNodeId ?? 'root'}`
  useEffect(() => {
    const known = srcNat ?? 0
    setSrcDur(known)
    const cap = isEditMode ? (caps?.maxInSec ?? 10) : 15
    const wIn = !selNodeId && root?.inSec != null ? root.inSec : 0
    let wOut = !selNodeId && root?.outSec != null ? root.outSec : known > 0 ? Math.min(known, wIn + cap) : 0
    if (known > 0) wOut = Math.min(wOut, known)
    setInS(wIn)
    setOutS(Math.min(wOut, wIn + cap))
    setStatus('idle')
    setPlaying(false)
    jogRef.current?.paintTime(0)
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

  // window caps per mode — THE jog bar itself is the shared ui/JogBar widget (Clip Monitor canon)
  const minSpan = isEditMode ? Math.max(0.25, caps?.minInSec ?? 0.25) : 2
  const maxSpan = isEditMode ? (caps?.maxInSec ?? 10) : 15
  const span = Math.max(0, outS - inS)
  const overMax = span > maxSpan + 0.001

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
  const extraVSecs = extraVideoRefs.map((r) => vrefSecOf(project, r))
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

  const run = (lane: 'queue' | 'now' = 'queue'): void => {
    if (!root || !srcFile) return
    if (!prompt.trim()) return void toast('write the instruction first', { kind: 'error' })
    if (problems.length) return void toast(problems[0], { kind: 'error' })
    const sendWindow = srcDur > 0 ? inS > 0.01 || outS < srcDur - 0.01 : outS > inS
    const dispatch = lane === 'now' ? useStore.getState().renderNow : useStore.getState().enqueueRender
    dispatch({
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
    setStatus(lane === 'now' ? 'rendering now — watch the Queue panel' : 'queued → watch the Queue panel')
  }

  // ---- bakes + node actions ----
  const bakeLibrary = async (nodeId: string): Promise<void> => {
    if (!session) return
    const r = await vd().veditBakeLibrary(session.id, nodeId)
    if (!r) return void toast('bake failed', { kind: 'error' })
    applyDelta(r.delta)
    toast('baked → Library videos ✓ (usable as an @video ref)', { kind: 'ok' })
  }
  const bakeClip = async (nodeId: string, clipId?: string): Promise<void> => {
    if (!session) return
    const r = await vd().veditBakeClip(session.id, nodeId, clipId ? { clipId } : {})
    if (!r) return void toast('bake failed', { kind: 'error' })
    applyDelta(r.delta)
    useStore.getState().selectClip(r.clipId)
    toast(clipId ? 'baked → new take on the clip ✓' : 'baked → new clip in the Bin ✓', { kind: 'ok' })
  }
  const setPrimary = async (nodeId: string | null): Promise<void> => {
    if (!session) return
    const d = await vd().veditSetPrimary(session.id, nodeId)
    if (!d) return void toast('only Library-video sources can take a ◉ primary (takes are immutable)', { kind: 'error' })
    applyDelta(d)
    toast(nodeId ? '◉ primary set — every @video ref using this Library video follows' : 'reverted to the original', { kind: 'ok' })
  }
  const deleteBranch = async (nodeId: string): Promise<void> => {
    if (!session) return
    const kids = nodes.filter((x) => x.parentId === nodeId).length
    if (!(await confirmDialog(`Delete this node${kids ? ' and its whole branch' : ''}? Renders are removed from disk (baked copies survive). (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true }))) return
    const d = await vd().veditDeleteBranch(session.id, nodeId)
    if (!d) return void toast("can't delete — the ◉ primary lives in this branch (revert it first)", { kind: 'error' })
    applyDelta(d)
    if (selNodeId === nodeId) setSelNodeId(null)
  }

  if (!root || !srcFile) {
    return (
      <EmptyState title="Video Editor — non-destructive v2v tree">
        Right-click a Library video or a take → <b>⑂ edit v2v</b> (double-click a Library video works too).
        Every generation lands as a node you can branch, compare, and bake — the source is never touched.
        <br />
        Bake any node: → take on a clip · → new clip · → Library videos (then it works as an @video ref).
      </EmptyState>
    )
  }

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

      {/* setup — engine · output (top, exactly like Clip Gen's Model card); the engine's story
          lives in the tooltip (tooltip law 2026-09-01), dials at natural widths */}
      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div className="lb">engine</div>
          <Dropdown
            value={engine}
            options={VEDIT_ENGINES.map((m) => ({ value: m.id, label: m.v2v && m.maxRefVideos === 0 ? `${m.label} — true edit` : `${m.label} — re-gen with refs` }))}
            onChange={(v) => setEngine(v as EngineId)}
            title={
              'edit engine — switching keeps ALL inputs; unsupported ones grey out\n' +
              (isEditMode ? 'frame-true edit · prompt only · output 720p 16:9 · window ≤10s' : `guided re-generation · source = @video1 · full ref suite${model.notes ? ` · ${model.notes}` : ''}`)
            }
          />
        </div>
      </div>
      <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', ...(isEditMode ? { opacity: 0.55 } : {}) }} title={isEditMode ? `${model.label} controls its own output (720p 16:9, length = the window) — these apply to re-gen engines` : undefined}>
        <div>
          <div className="lb">duration</div>
          <Dropdown value={duration} disabled={isEditMode} options={withCurrent(model.durations, duration).map((d) => ({ value: d, label: d }))} onChange={setDuration} style={{ width: 78 }} />
        </div>
        <div>
          <div className="lb">resolution</div>
          <Dropdown value={resolution} disabled={isEditMode} options={withCurrent(model.resolutions, resolution).map((r) => ({ value: r, label: r }))} onChange={setResolution} style={{ width: 90 }} />
        </div>
        <div>
          <div className="lb">aspect</div>
          <Dropdown value={aspect} disabled={isEditMode} options={withCurrent(model.aspectRatios, aspect).map((a) => ({ value: a, label: aspectLabel(a) }))} onChange={setAspect} style={{ width: 104 }} />
        </div>
        <div style={{ flex: '0 0 auto', alignSelf: 'flex-end', paddingBottom: 5 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: isEditMode ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={isEditMode ? true : genAudio} disabled={isEditMode} onChange={(e) => setGenAudio(e.target.checked)} />
            <span className="lb" style={{ margin: 0 }}>{isEditMode ? 'audio: always on' : 'generate audio'}</span>
          </label>
        </div>
      </div>

      {/* preview + THE timeline strip (seek + send-window on one bar) */}
      <div ref={pvBoxRef} style={{ position: 'relative', background: '#000', borderRadius: 6, overflow: 'hidden', height: previewH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            jogRef.current?.paintTime(v.currentTime)
            // playback loops inside the send-window — that's exactly what the model receives
            if (!v.paused && srcDur > 0 && v.currentTime > outS - 0.03) v.currentTime = inS
          }}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
        />
        <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4, pointerEvents: 'none' }}>
          {selNode ? 'node — Generate runs FROM this' : 'original'}
          {!playing ? ' · click to play' : ''}
        </span>
      </div>
      {/* the monitor's drag height — Clip Gen's handle, persisted (one resize app-wide, his order 2026-09-09) */}
      <ResizeHandle
        value={previewH}
        maxOf={() => {
          const sc = pvBoxRef.current?.closest('.vd-scroll') as HTMLElement | null
          return (sc?.clientHeight ?? 640) - 60
        }}
        onChange={(h) => setPreviewH('clipEdit', h)}
      />
      <JogBar
        ref={jogRef}
        videoRef={vidRef}
        srcDur={srcDur}
        inS={inS}
        outS={outS}
        setInS={setInS}
        setOutS={setOutS}
        minSpan={minSpan}
        maxSpan={maxSpan}
        label={`${selNode ? 'node' : 'original'}${rootName ? ` · ${rootName}` : ''}`}
        windowNote={!isEditMode ? ' — sent as @video1' : ''}
        playing={playing}
        muted={pvMuted}
        onTogglePlay={togglePlay}
        onToggleMute={toggleMute}
      />

      {/* prompt */}
      <div className="field">
        <div className="lb" title="@mention the refs to bind them">{isEditMode ? 'edit instruction' : 're-gen prompt'}</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={isEditMode ? 'Make it nighttime. Keep everything else the same.' : 'Restyle @video1 to match @image1. Keep the exact motion and timing.'}
          rows={3}
          style={{ ...ctl, width: '100%', resize: 'vertical' }}
        />
        {isEditMode && caps && <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{caps.promptHint}</div>}
      </div>
      <RefSuite
        model={model}
        parked={isEditMode}
        parkedReason={`${model.label} takes no refs — these are kept but will NOT be sent`}
        sourceIsVideo1
        prompt={prompt}
        imageRefIds={imageRefIds}
        setImageRefIds={setImageRefIds}
        videoRefs={extraVideoRefs}
        setVideoRefs={setExtraVideoRefs}
        audioRefs={audioRefs}
        setAudioRefs={setAudioRefs}
      />

      {/* generate bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="btn" style={{ flex: 1 }} onClick={() => run('now')}>▶ Generate now {isEditMode ? 'edit' : 're-gen'} {selNode ? 'from this node' : 'from the original'}</span>
        <span className="btn" title="add to the render queue — runs in order, one at a time" onClick={() => run('queue')}>＋ Queue</span>
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
          <span title="click = select & view (Generate runs FROM the selection) · right-click = actions">results tree</span>
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
              draggable
              onDragStart={(e) => {
                // KEEPING a result = dragging it out: Bin space → new clip · clip card → new
                // take on it · timeline → clip + block at the drop point (bake rides the drop)
                e.dataTransfer.setData(MIME_VEDITNODE, JSON.stringify({ sessionId: session?.id ?? '', nodeId: node.id }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => setSelNodeId(node.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setNodeMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
              }}
              title={`${node.prompt}\n${modelFor(node.engine).label}${node.refSummary ? ' · ' + node.refSummary : ''}${node.inSec != null && node.outSec != null ? ` · window ${node.inSec.toFixed(1)}–${node.outSec.toFixed(1)}s` : ''}\nclick = select & view · DRAG OUT to keep (Bin = new clip · clip card = take · timeline = block) · right-click = bake / ◉ / delete`}
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
